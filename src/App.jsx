import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, CheckCircle, Play, Download, Loader2, Pause, Trash2, Settings, Save, Siren, Activity, Key, Ban, RotateCcw, Stethoscope, Check, X, Edit3, Flame, LogOut, FolderOpen, FileDown, ShieldCheck, Merge, Archive, Sparkles, ClipboardCopy } from 'lucide-react';
import { initializeApp } from 'firebase/app';
// import JSZip from 'jszip'; // 環境依存エラー回避のため削除し、CDNロードに変更

// ==========================================
// 定数・設定
// ==========================================
const FIXED_PASSWORD = 'admin123';

const RISK_MAP = {
  'Critical': { label: '回収対象(確定)', color: 'bg-orange-100 text-orange-800 border-orange-200 ring-1 ring-orange-300' }, 
  'High': { label: '要確認(疑いあり)', color: 'bg-amber-100 text-amber-800 border-amber-200' },      
  'Medium': { label: '一般玩具(除外)', color: 'bg-slate-100 text-slate-500' }, 
  'Low': { label: '対象外', color: 'bg-slate-50 text-slate-300' },
  'Error': { label: '解析エラー', color: 'bg-gray-200 text-gray-800 border-gray-300' }
};

const MODELS = [
  { id: 'gemini-3.0-flash', name: 'Gemini 3.0 Flash (最新)' },
  { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash Exp (実験的)' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (安定)' },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash-8B (軽量)' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (高精度)' },
];

const DEFAULT_MODEL = 'gemini-3.0-flash';
const FALLBACK_MODEL = 'gemini-1.5-flash';

// 商品名を特定するためのキーワード（優先順）
const PRODUCT_NAME_KEYWORDS = ['商品名', 'product', 'name', 'title', 'item', '名称', '品名'];

// ==========================================
// 1. ユーティリティ
// ==========================================
const parseCSV = (text) => {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { currentField += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField); currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField); currentField = '';
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
    } else { currentField += char; }
  }
  if (currentField || currentRow.length > 0) { currentRow.push(currentField); rows.push(currentRow); }
  return rows;
};

const readFileAsText = (file, encoding) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file, encoding);
  });
};

const cleanJson = (text) => {
  try {
    let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) return arrayMatch[0];
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) return `[${objMatch[0]}]`;
    return cleaned;
  } catch (e) { return text; }
};

const parseKeys = (text) => {
  if (!text) return [];
  return text.split(/[\n, ]+/)
    .map(k => k.trim())
    .filter(k => k.length > 10 && k.startsWith('AIza')); 
};

// ユニークID生成
const generateId = () => Math.random().toString(36).substr(2, 9);

// JSZipをCDNからロードするフック
const useJSZip = () => {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (window.JSZip) {
      setIsLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => setIsLoaded(true);
    document.body.appendChild(script);
  }, []);

  return isLoaded;
};

// ==========================================
// 2. API呼び出し関数
// ==========================================

async function generateSafetyReport(riskyItems, apiKey, modelId) {
  const itemsText = riskyItems.map(item => `- [${item.risk}] ${item.productName}: ${item.reason}`).join('\n');
  const systemInstruction = `
あなたはトイガン安全管理の責任者です。
スクリーニングの結果、検出された以下の危険な玩具銃リストに基づき、社内または関係機関への報告用レポートを作成してください。

【レポート構成】
1. **概要**: 検出された危険商品の総数と、Critical/Highの内訳。
2. **主な検出事項**: 「REAL GIMMICK」シリーズや金属製リボルバーなど、特に注意すべき具体的な商品名の傾向。
3. **リスク評価**: なぜこれらが危険なのか（銃刀法、実弾発射能力の懸念など）を簡潔に。
4. **推奨アクション**: 直ちに販売停止、在庫隔離、警察への相談などを指示する内容。

文体は「報告書」として適切で、簡潔かつ断定的なトーンで作成してください。
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: `以下の検出結果からレポートを作成せよ:\n${itemsText}` }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) throw new Error(`Report Gen Error: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "レポート生成に失敗しました。";
}

async function checkIPRiskBulkWithRotation(products, availableKeys, setAvailableKeys, modelId, isFallback = false) {
  if (availableKeys.length === 0) {
    throw new Error("ALL_KEYS_DEAD: 有効なAPIキーがありません");
  }

  const apiKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  const productsListText = products.map(p => `ID:${p.id} 商品名:${p.productName}`).join('\n');
  
  const systemInstruction = `
あなたは真正拳銃回収スクリーニングシステムです。
入力データから、警察庁指定の「真正拳銃と認定された玩具銃（全16種類）」に該当する危険な商品を抽出してください。

【対象】
- "REAL GIMMICK", "MINI REVOLVER", "YUMEYA", "SOPEN" を含む商品
- 金属製(Full Metal)、薬莢排出、リアル構造を謳う海外製小型リボルバー

【出力形式】
以下のJSON配列フォーマットのみを出力してください。**解説や前置きは一切不要です。**
[{"id": "ID文字列", "risk_level": "Critical", "reason": "理由"}, ...]

risk_levelは以下のいずれか:
- Critical: 回収対象（REAL GIMMICK等）
- High: 要確認（海外製フルメタル等）
- Medium: 国内安全品（ASGKマーク等）
- Low: 対象外
`;

  const currentModelId = isFallback ? FALLBACK_MODEL : (modelId || DEFAULT_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModelId}:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{ parts: [{ text: productsListText }] }], 
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { 
      responseMimeType: "application/json",
      temperature: 0.1
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (response.status === 404) {
      if (!isFallback && currentModelId !== FALLBACK_MODEL) {
        return checkIPRiskBulkWithRotation(products, availableKeys, setAvailableKeys, FALLBACK_MODEL, true);
      }
    }

    if (response.status === 400 || response.status === 403) {
      const newKeys = availableKeys.filter(k => k !== apiKey);
      if (setAvailableKeys) setAvailableKeys(newKeys);
      return checkIPRiskBulkWithRotation(products, newKeys, setAvailableKeys, currentModelId, isFallback);
    }

    if (response.status === 429 || response.status === 503) {
      const waitTime = 3000 + Math.random() * 4000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return checkIPRiskBulkWithRotation(products, availableKeys, setAvailableKeys, currentModelId, isFallback);
    }
    
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    
    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("No response content");
    
    const cleanText = cleanJson(rawText);
    let parsedResults;
    try {
        parsedResults = JSON.parse(cleanText);
        if (!Array.isArray(parsedResults) && typeof parsedResults === 'object') {
            parsedResults = [parsedResults];
        }
    } catch (e) {
        throw new Error(`解析不能: ${e.message}`);
    }

    if (!Array.isArray(parsedResults)) throw new Error("Not an array");

    const resultMap = {};
    parsedResults.forEach(item => {
      const matchingProduct = products.find(p => String(p.id) === String(item.id));
      if (!matchingProduct) return;

      let risk = item.risk_level ? String(item.risk_level).trim() : 'Low';
      
      if (risk.includes('Critical')) risk = 'Critical';
      else if (risk.includes('High')) risk = 'High';
      else if (risk.includes('Medium')) risk = 'Medium';
      else if (risk.includes('Low')) risk = 'Low';
      
      if (['危険', 'Critical'].includes(risk)) risk = 'Critical';
      else if (['高', 'High'].includes(risk)) risk = 'High';
      else if (['中', 'Medium'].includes(risk)) risk = 'Medium';
      else risk = 'Low';
      
      resultMap[matchingProduct.id] = { risk, reason: item.reason };
    });
    
    products.forEach(p => {
        if (!resultMap[p.id]) {
            resultMap[p.id] = { risk: "Low", reason: "判定なし(安全)" };
        }
    });

    return resultMap;

  } catch (error) {
    if (error.message.includes("ALL_KEYS_DEAD")) throw error;
    const errorMap = {};
    products.forEach(p => {
      errorMap[p.id] = { risk: "Error", reason: error.message };
    });
    return errorMap;
  }
}

// ==========================================
// 3. メインコンポーネント
// ==========================================
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [inputPassword, setInputPassword] = useState('');
  
  const [apiKeysText, setApiKeysText] = useState('');
  const [activeKeys, setActiveKeys] = useState([]); 
  const [keyStatuses, setKeyStatuses] = useState({}); 
  
  const [firebaseConfigJson, setFirebaseConfigJson] = useState('');
  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [customModelId, setCustomModelId] = useState(''); 
  
  const [activeTab, setActiveTab] = useState('checker');
  
  const [inventory, setInventory] = useState([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const [reportText, setReportText] = useState('');
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  const [statusState, setStatusState] = useState({
    message: '待機中',
    successCount: 0,
    errorCount: 0,
    currentBatch: 0,
    totalBatches: 0,
    deadKeysCount: 0 
  });

  const [encoding, setEncoding] = useState('Shift_JIS');
  const [isHighSpeed, setIsHighSpeed] = useState(true); 
  const stopRef = useRef(false);

  // JSZipロード
  const isZipLoaded = useJSZip();

  useEffect(() => {
    const savedKeys = localStorage.getItem('gemini_api_keys'); 
    const savedFbConfig = localStorage.getItem('firebase_config');
    const savedModel = localStorage.getItem('gemini_model');
    const savedCustomModel = localStorage.getItem('gemini_custom_model');
    
    if (savedKeys) {
      setApiKeysText(savedKeys);
      setActiveKeys(parseKeys(savedKeys));
    }

    if (savedModel) setModelId(savedModel);
    if (savedCustomModel) setCustomModelId(savedCustomModel);
    
    if (savedFbConfig) {
      setFirebaseConfigJson(savedFbConfig);
      try {
        const config = JSON.parse(savedFbConfig);
        initializeApp(config);
      } catch (e) { console.warn("Firebase Init Warning:", e); }
    }
  }, []);

  useEffect(() => {
    setActiveKeys(parseKeys(apiKeysText));
  }, [apiKeysText]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (inputPassword === FIXED_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert("パスワードが違います");
    }
  };

  const saveSettings = () => {
    localStorage.setItem('gemini_api_keys', apiKeysText);
    localStorage.setItem('firebase_config', firebaseConfigJson);
    localStorage.setItem('gemini_model', modelId);
    localStorage.setItem('gemini_custom_model', customModelId);
    alert("設定を保存しました");
  };

  const testConnection = async () => {
    const keys = parseKeys(apiKeysText);
    if (keys.length === 0) return alert("APIキーが入力されていません");
    
    setKeyStatuses({});
    let results = {};
    let validKeys = [];
    
    const targetModel = modelId === 'custom' ? customModelId : modelId;

    for (const key of keys) {
      results[key] = { status: 'loading' };
      setKeyStatuses({...results});
      
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${key}`;
        let res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
        });
        
        if (res.ok) {
          results[key] = { status: 'ok', msg: `接続OK (${targetModel})` };
          validKeys.push(key);
        } else if (res.status === 404) {
          const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_MODEL}:generateContent?key=${key}`;
          const resFallback = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: "Hello" }] }] })
          });
          
          if (resFallback.ok) {
             results[key] = { status: 'ok', msg: `${FALLBACK_MODEL}でOK` };
             validKeys.push(key);
          } else {
             results[key] = { status: 'error', msg: '無効なキー' };
          }
        } else {
          results[key] = { status: 'error', msg: `エラー: ${res.status}` };
        }
      } catch (e) {
        results[key] = { status: 'error', msg: '通信エラー' };
      }
      setKeyStatuses({...results});
    }
    
    if (validKeys.length > 0) {
      setActiveKeys(validKeys);
    }
  };

  const handleFileUpload = async (e) => {
    const uploadedFiles = e.target.files ? Array.from(e.target.files) : [];
    if (uploadedFiles.length === 0) return;
    
    let newItems = [];

    const processFile = async (file) => {
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.zip')) {
        if (!isZipLoaded || !window.JSZip) {
          alert('ZIP機能の準備中です。数秒待ってから再度お試しください。');
          return;
        }
        try {
          const zip = new window.JSZip();
          const loadedZip = await zip.loadAsync(file);
          const entries = Object.keys(loadedZip.files).map(name => loadedZip.files[name]);
          for (const entry of entries) {
            if (!entry.dir && entry.name.toLowerCase().endsWith('.csv')) {
              const binary = await entry.async('uint8array');
              let text;
              try {
                  const decoder = new TextDecoder(encoding === 'Shift_JIS' ? 'shift-jis' : 'utf-8');
                  text = decoder.decode(binary);
              } catch(e) {
                  text = await entry.async('string');
              }
              const items = parseAndExtractItems(text, entry.name);
              newItems.push(...items);
            }
          }
        } catch (err) {
          console.error("ZIP Error", err);
          alert(`${file.name}の解凍に失敗しました。`);
        }
      } else if (fileName.endsWith('.csv')) {
        try {
          const text = await readFileAsText(file, encoding);
          const items = parseAndExtractItems(text, file.name);
          newItems.push(...items);
        } catch (err) {
          alert(`${file.name}の読み込みに失敗しました。`);
        }
      }
    };

    await Promise.all(uploadedFiles.map(processFile));
    
    if (newItems.length > 0) {
      setInventory(prev => [...prev, ...newItems]);
    }
  };

  const parseAndExtractItems = (text, fileName) => {
    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const headers = rows[0];
    const dataRows = rows.slice(1);

    let nameIndex = -1;
    for (const keyword of PRODUCT_NAME_KEYWORDS) {
      const idx = headers.findIndex(h => h.toLowerCase().includes(keyword));
      if (idx !== -1) {
        nameIndex = idx;
        break;
      }
    }

    if (nameIndex === -1) {
      nameIndex = 0; 
    }

    return dataRows.map(row => ({
      id: generateId(),
      productName: row[nameIndex] || "(不明)",
      originalRow: row,
      headers: headers,
      fileName: fileName,
      risk: 'Unchecked', 
      reason: ''
    }));
  };

  const downloadResultCSV = () => {
    const targetItems = inventory.filter(i => ['Critical', 'High'].includes(i.risk));
    if (targetItems.length === 0) return alert("抽出されたデータがありません");
    
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let csvContent = "ファイル名,判定日時,リスク判定,理由,商品名,元データ(全列結合)\n";
    
    targetItems.forEach(item => {
      const riskLabel = RISK_MAP[item.risk]?.label || item.risk;
      const reason = `"${(item.reason || '').replace(/"/g, '""')}"`;
      const fileName = `"${item.fileName}"`;
      const date = new Date().toLocaleString();
      const pName = `"${(item.productName || '').replace(/"/g, '""')}"`;
      const originalDataStr = item.originalRow.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
      csvContent += `${fileName},${date},${riskLabel},${reason},${pName},${originalDataStr}\n`;
    });

    const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `dangerous_guns_list_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click(); 
    document.body.removeChild(link);
  };

  const handleGenerateReport = async () => {
    const displayResults = inventory.filter(i => ['Critical', 'High'].includes(i.risk));
    if (displayResults.length === 0) return alert("レポート対象となる危険データがありません。");
    
    if (activeKeys.length === 0) return alert("APIキーがありません。");
    
    setIsGeneratingReport(true);
    try {
      const report = await generateSafetyReport(
        displayResults, 
        activeKeys[0], 
        modelId === 'custom' ? customModelId : modelId
      );
      setReportText(report);
    } catch (e) {
      alert("レポート生成に失敗しました: " + e.message);
    }
    setIsGeneratingReport(false);
  };

  const handleCopyReport = () => {
    navigator.clipboard.writeText(reportText);
    alert("レポートをコピーしました");
  };

  const handleReset = () => {
    if (isProcessing && !confirm("処理を中断して初期化しますか？")) return;
    setInventory([]);
    setResults([]);
    setReportText('');
    setProgress(0);
    setStatusState({ 
      message: '待機中', 
      successCount: 0, 
      errorCount: 0, 
      currentBatch: 0, 
      totalBatches: 0, 
      deadKeysCount: 0 
    });
    setIsProcessing(false);
    stopRef.current = true;
  };

  const startProcessing = async () => {
    const initialKeys = parseKeys(apiKeysText);
    setActiveKeys(initialKeys);

    if (initialKeys.length === 0) return alert("有効なAPIキーが設定されていません。");
    
    const uncheckedItems = inventory.filter(i => i.risk === 'Unchecked');
    if (uncheckedItems.length === 0) return alert("未判定のデータがありません。");

    setIsProcessing(true);
    stopRef.current = false;
    setProgress(0);
    setReportText(''); 
    
    const total = uncheckedItems.length;
    setStatusState({ 
      message: '初期化中...', 
      successCount: 0, 
      errorCount: 0, 
      currentBatch: 0, 
      totalBatches: Math.ceil(total / 30), 
      deadKeysCount: 0
    });

    const BULK_SIZE = 30; 
    const CONCURRENCY = isHighSpeed ? 3 : 2;

    let currentIndex = 0;
    const initialJitter = Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, initialJitter));

    const currentModelId = modelId === 'custom' ? customModelId : modelId;

    const updateInventory = (updates) => {
      setInventory(prev => prev.map(item => {
        const update = updates.find(u => u.id === item.id);
        return update ? { ...item, ...update } : item;
      }));
    };

    while (currentIndex < total) {
      if (stopRef.current) break;
      
      const tasks = [];
      const currentBatchNum = Math.floor(currentIndex / BULK_SIZE) + 1;
      
      setStatusState(prev => ({
        ...prev,
        message: `安全チェック進行中... (${currentIndex}/${total}件)`,
        currentBatch: currentBatchNum,
      }));

      for (let c = 0; c < CONCURRENCY; c++) {
        const chunkStart = currentIndex + (c * BULK_SIZE);
        if (chunkStart >= total) break;
        const chunkEnd = Math.min(chunkStart + BULK_SIZE, total);
        
        const chunkProducts = [];
        for (let i = chunkStart; i < chunkEnd; i++) {
          chunkProducts.push(uncheckedItems[i]);
        }
        
        if (chunkProducts.length > 0) {
          tasks.push(
            checkIPRiskBulkWithRotation(chunkProducts, activeKeys, setActiveKeys, currentModelId).then(resultMap => {
              const updates = chunkProducts.map(p => ({
                id: p.id,
                risk: resultMap[p.id]?.risk || "Error",
                reason: resultMap[p.id]?.reason || "判定失敗",
              }));
              updateInventory(updates);
              return updates;
            })
          );
        }
      }

      if (tasks.length > 0) {
        try {
          const chunkResults = await Promise.all(tasks);
          const flatUpdates = chunkResults.flat();
          
          const dangerousCount = flatUpdates.filter(u => ['Critical', 'High'].includes(u.risk)).length;
          const errorCount = flatUpdates.filter(u => u.risk === 'Error').length;
          
          setStatusState(prev => ({
            ...prev,
            successCount: prev.successCount + dangerousCount,
            errorCount: prev.errorCount + errorCount
          }));

          currentIndex += tasks.reduce((acc, _, idx) => {
             const processedInTask = Math.min(currentIndex + ((idx + 1) * BULK_SIZE), total) - (currentIndex + (idx * BULK_SIZE));
             return acc + (processedInTask > 0 ? processedInTask : 0);
          }, 0);
          
          const nextProgress = Math.round((currentIndex / total) * 100);
          setProgress(nextProgress);

        } catch (e) {
          console.error("Batch error:", e);
          currentIndex += (CONCURRENCY * BULK_SIZE);
        }
      }

      const baseWait = isHighSpeed ? 300 : 1500;
      if (currentIndex < total) await new Promise(resolve => setTimeout(resolve, baseWait));
    }
    
    setProgress(100);
    setStatusState(prev => ({ ...prev, message: 'チェック完了' }));
    setIsProcessing(false);
  };

  const downloadMergedCSV = () => {
    if (csvData.length === 0 && inventory.length === 0) return alert("データがありません");
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    
    const baseHeaders = inventory[0]?.headers || [];
    let csvContent = baseHeaders.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + "\n";
    
    inventory.forEach(item => {
      const rowString = item.originalRow.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
      csvContent += rowString + "\n";
    });

    const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `merged_data_${new Date().getTime()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const displayResults = inventory.filter(i => ['Critical', 'High'].includes(i.risk));

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-16 rounded-2xl shadow-2xl w-full max-w-5xl transition-all border border-slate-200">
          <div className="flex flex-col items-center">
            <div className="bg-teal-600 p-6 rounded-full mb-8 shadow-lg shadow-teal-200"><ShieldCheck className="w-16 h-16 text-white" /></div>
            <h1 className="text-4xl font-black text-center text-slate-800 mb-2 tracking-tight">トイガン・セーフティチェック <span className="text-teal-600">Ver.2</span></h1>
            <span className="text-sm font-bold bg-slate-100 text-slate-500 px-4 py-1.5 rounded-full mb-10">ZIP / 複数ファイル対応版</span>
          </div>
          <form onSubmit={handleLogin} className="space-y-8 max-w-xl mx-auto"> 
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2">パスワード</label>
              <input type="password" value={inputPassword} onChange={(e) => setInputPassword(e.target.value)} className="w-full px-6 py-4 border border-slate-300 rounded-xl focus:ring-4 focus:ring-teal-100 focus:border-teal-500 outline-none transition-all text-lg" placeholder="パスワードを入力" autoFocus />
            </div>
            <button type="submit" className="w-full bg-teal-600 text-white py-4 rounded-xl font-bold text-xl hover:bg-teal-700 shadow-xl shadow-teal-200 transition-all active:scale-95">ログインして開始</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 font-black text-slate-800 text-xl">
            <ShieldCheck className="w-8 h-8 text-teal-600" />
            <span>トイガン・セーフティチェック <span className="text-xs font-medium text-white bg-teal-600 px-2 py-0.5 rounded ml-1">Ver.2</span></span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setActiveTab('checker')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'checker' ? 'bg-teal-50 text-teal-600' : 'text-slate-500 hover:bg-slate-50'}`}>スクリーニング</button>
            <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'settings' ? 'bg-teal-50 text-teal-600' : 'text-slate-500 hover:bg-slate-50'}`}>設定</button>
            <button onClick={() => setIsAuthenticated(false)} className="ml-2 p-2 text-slate-400 hover:text-red-500"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        {activeTab === 'checker' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* 上部ステータス */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div className="p-4 rounded-lg border flex items-center gap-3 bg-slate-50 border-slate-200">
                  <Activity className="w-5 h-5 text-teal-600" />
                  <div className="w-full">
                    <p className="text-xs text-slate-500 font-bold">ステータス</p>
                    <p className="text-sm font-bold truncate w-full text-slate-700">{statusState.message}</p>
                  </div>
                </div>
                <div className="p-4 rounded-lg border bg-teal-50 border-teal-200 flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-teal-600" />
                  <div>
                    <p className="text-xs text-teal-600 font-bold">発見件数</p>
                    <p className="text-xl font-bold text-teal-700">{statusState.successCount} <span className="text-xs font-normal text-slate-500">/ 危険</span></p>
                  </div>
                </div>
                <div className="p-4 rounded-lg border bg-indigo-50 border-indigo-200 flex items-center gap-3">
                  <Settings className="w-5 h-5 text-indigo-600" />
                  <div>
                    <p className="text-xs text-indigo-600 font-bold">読み込み件数</p>
                    <p className="text-xl font-bold text-indigo-700">{inventory.length} <span className="text-xs font-normal">items</span></p>
                  </div>
                </div>
              </div>

              {/* ファイルアップロード＆設定エリア */}
              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1">
                  <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-teal-50 transition-colors relative cursor-pointer min-h-[160px] flex flex-col items-center justify-center group">
                    <input type="file" accept=".csv,.zip" multiple onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                    <FolderOpen className="w-10 h-10 text-slate-400 mb-3 group-hover:text-teal-500 transition-colors" />
                    <p className="text-base font-bold text-slate-700">CSV または ZIPファイルをドロップ</p>
                    <p className="text-xs text-slate-500 mt-1">複数ファイル対応・自動結合</p>
                  </div>
                  {inventory.length > 0 && (
                    <div className="mt-4 bg-slate-50 rounded-lg p-3 border border-slate-100 flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-600">読み込み完了: {inventory.length} 件のデータ</span>
                      <div className="flex gap-2">
                        <button onClick={downloadMergedCSV} className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-bold bg-indigo-50 px-3 py-1.5 rounded border border-indigo-200 hover:bg-indigo-100 transition-colors"><Merge className="w-3 h-3" /> 元データ結合</button>
                        <button onClick={handleReset} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"><Trash2 className="w-3 h-3" /> リセット</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="w-full lg:w-80 space-y-4">
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">読込オプション</h3>
                    <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className="w-full px-3 py-2 border rounded bg-white text-sm">
                      <option value="Shift_JIS">Shift_JIS (Excel/楽天)</option>
                      <option value="UTF-8">UTF-8 (Web/一般)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">※ZIP内のCSVもこの文字コードで読み込みます</p>
                  </div>
                  <div onClick={() => setIsHighSpeed(!isHighSpeed)} className={`p-4 rounded-lg border cursor-pointer transition-all ${isHighSpeed ? 'bg-teal-50 border-teal-200 ring-2 ring-teal-100' : 'bg-white border-slate-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2"><Flame className={`w-5 h-5 ${isHighSpeed ? 'text-teal-600 fill-teal-600' : 'text-slate-400'}`} /><span className={`font-bold text-sm ${isHighSpeed ? 'text-teal-900' : 'text-slate-600'}`}>高速チェック</span></div>
                      <div className={`w-10 h-5 rounded-full relative transition-colors ${isHighSpeed ? 'bg-teal-600' : 'bg-slate-300'}`}><div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${isHighSpeed ? 'left-6' : 'left-1'}`} /></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* プログレスバー & 操作ボタン */}
              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>{statusState.message}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-teal-500 to-emerald-600 transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  
                  {!isProcessing ? (
                    <button onClick={startProcessing} disabled={inventory.length === 0} className="flex items-center gap-2 px-8 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-md transition-transform active:scale-95 whitespace-nowrap"><Play className="w-5 h-5" /> チェック開始</button>
                  ) : (
                    <button onClick={() => {stopRef.current = true; setIsProcessing(false); setStatusState(p => ({...p, message: '停止しました'}));}} className="flex items-center gap-2 px-8 py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-md transition-transform active:scale-95 whitespace-nowrap"><Pause className="w-5 h-5" /> 一時停止</button>
                  )}
                </div>
              </div>
            </div>

            {/* 結果テーブル */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[600px]">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                <div className="flex items-center gap-3">
                  <h2 className="font-bold text-slate-700 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-teal-600" /> 検出された危険商品 ({displayResults.length}件)</h2>
                  {displayResults.length > 0 && !isGeneratingReport && (
                    <button onClick={handleGenerateReport} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-amber-100 font-bold transition-colors">
                      <Sparkles className="w-3 h-3" /> 判定レポート生成
                    </button>
                  )}
                  {isGeneratingReport && <span className="text-xs text-amber-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> レポート生成中...</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={downloadResultCSV} disabled={displayResults.length === 0} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-teal-200 disabled:opacity-50 transition-colors"><Download className="w-4 h-4" /> 回収リストをCSV保存 (元データ付)</button>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                    <tr><th className="px-4 py-3 w-32 text-center">判定</th><th className="px-4 py-3 w-1/3">商品名</th><th className="px-4 py-3">リスク・理由</th><th className="px-4 py-3 w-32">元ファイル</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayResults.length === 0 && !isProcessing && (
                      <tr><td colSpan="4" className="px-4 py-12 text-center text-slate-400"><CheckCircle className="w-12 h-12 mx-auto mb-2 text-slate-300" /><p>危険な商品は検出されていません。（安全な商品は非表示です）</p></td></tr>
                    )}
                    {displayResults.map((item, idx) => (
                      <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${item.risk === 'Critical' ? 'bg-orange-50' : ''}`}>
                        <td className="px-4 py-3 text-center"><RiskBadge risk={item.risk} /></td>
                        <td className="px-4 py-3"><div className="font-medium text-slate-700 line-clamp-2" title={item.productName}>{item.productName}</div></td>
                        <td className="px-4 py-3"><div className="text-xs text-slate-600">{item.reason}</div></td>
                        <td className="px-4 py-3 text-xs text-slate-400 truncate max-w-[150px]" title={item.fileName}>{item.fileName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* レポート表示エリア */}
            {reportText && (
              <div className="bg-amber-50 p-6 rounded-xl border border-amber-200 mt-6 shadow-sm animate-in slide-in-from-bottom-2">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="font-bold text-amber-900 flex items-center gap-2"><Sparkles className="w-5 h-5" /> 自動生成レポート (Gemini)</h3>
                  <button onClick={handleCopyReport} className="text-xs bg-white text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg flex items-center gap-1 hover:bg-amber-100 transition-colors"><ClipboardCopy className="w-3 h-3" /> コピー</button>
                </div>
                <div className="whitespace-pre-wrap text-sm text-amber-800 leading-relaxed font-mono bg-white p-4 rounded border border-amber-100">{reportText}</div>
              </div>
            )}
          </div>
        )}

        {/* 設定タブの内容は省略（変更なし） */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Settings className="w-5 h-5" /> アプリ設定</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Gemini API Keys</label>
                  <textarea value={apiKeysText} onChange={(e) => setApiKeysText(e.target.value)} className="w-full px-4 py-2 border rounded-lg bg-slate-50 h-32 font-mono text-sm" placeholder="AIza..." />
                  <div className="flex justify-between items-start mt-2">
                    <p className="text-xs text-slate-500">複数入力で負荷分散されます。</p>
                    <button onClick={testConnection} className="flex items-center gap-1 px-3 py-1 bg-teal-50 text-teal-700 border border-teal-200 rounded text-xs font-bold"><Stethoscope className="w-3 h-3" /> 接続テスト</button>
                  </div>
                  {Object.keys(keyStatuses).length > 0 && (
                    <div className="mt-2 space-y-1 p-2 bg-slate-50 rounded border border-slate-200 max-h-32 overflow-y-auto">
                      {Object.entries(keyStatuses).map(([key, status], idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs font-mono">
                          {status.status === 'ok' ? <Check className="w-3 h-3 text-teal-600" /> : <X className="w-3 h-3 text-rose-600" />}
                          <span className="text-slate-500">{key.slice(0, 8)}...</span>
                          <span className={status.status === 'ok' ? 'text-teal-600' : 'text-rose-600'}>{status.msg}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pt-4">
                  <button onClick={saveSettings} className="flex items-center justify-center gap-2 w-full bg-teal-600 text-white font-bold py-2 rounded-lg hover:bg-teal-700 shadow-sm"><Save className="w-4 h-4" /> 設定を保存</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}