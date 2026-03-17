/**
 * 京东Cookie和wskey获取并自动提交到API服务器
 * Loon适配版
 */

const API_URL = "http://1.sggg3326.top:9090/jd/raw_ck";

// 获取请求头中的 Cookie
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

// ---------- 队列操作（Loon版）----------

// 获取 wskey 队列
function getWskeyQueue() {
    let raw = $persistentStore.read("JD_Wskey_Queue");
    return raw ? JSON.parse(raw) : [];
}

// 保存 wskey 队列
function saveWskeyQueue(queue) {
    $persistentStore.write(JSON.stringify(queue), "JD_Wskey_Queue");
}

// 获取 pt_key 队列
function getPtKeyQueue() {
    let raw = $persistentStore.read("JD_PtKey_Queue");
    return raw ? JSON.parse(raw) : [];
}

// 保存 pt_key 队列
function savePtKeyQueue(queue) {
    $persistentStore.write(JSON.stringify(queue), "JD_PtKey_Queue");
}

// 清理过期数据（超过10秒）
function cleanExpired(queue, now) {
    return queue.filter(item => (now - item.timestamp) <= 10);
}

// 处理 wskey 请求
function handleWskeyRequest(wskey, timestamp) {
    try {
        let queue = getWskeyQueue();
        // 加入新元素
        queue.push({ wskey, timestamp });
        // 清理过期
        let now = Math.floor(Date.now() / 1000);
        queue = cleanExpired(queue, now);
        saveWskeyQueue(queue);
        console.log(`✅ wskey 已加入队列，当前队列长度: ${queue.length}`);
        
        // 尝试匹配
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
        
        // 当两个队列都非空时，尝试配对
        while (wskeyQueue.length > 0 && ptkeyQueue.length > 0) {
            let wskeyItem = wskeyQueue[0];
            let ptkeyItem = ptkeyQueue[0];
            
            let { wskey } = wskeyItem;
            let { pt_pin, pt_key } = ptkeyItem;
            
            console.log(`🔄 尝试配对: wskey(${wskey.substring(0,15)}...) <-> pt_pin(${pt_pin})`);
            
            // 去重检查
            if (checkIfProcessed(pt_pin, pt_key, wskey)) {
                console.log(`🔵 该组合已处理过，丢弃队列头部`);
                // 丢弃两个头部
                wskeyQueue.shift();
                ptkeyQueue.shift();
                continue;
            }
            
            // 记录已处理
            recordProcessed(pt_pin, pt_key, wskey);
            
            // 组合并提交
            combineAndSubmit(pt_pin, pt_key, wskey);
            
            // 从队列中移除已配对的元素
            wskeyQueue.shift();
            ptkeyQueue.shift();
        }
        
        // 保存更新后的队列
        saveWskeyQueue(wskeyQueue);
        savePtKeyQueue(ptkeyQueue);
    } catch (e) {
        console.log("匹配失败: " + e);
    }
}

// 检查是否已处理过
function checkIfProcessed(pt_pin, pt_key, wskey) {
    try {
        let processedRaw = $persistentStore.read("JD_Processed_Records");
        if (!processedRaw) return false;
        
        let processedData = JSON.parse(processedRaw);
        let key = generateRecordKey(pt_pin, pt_key, wskey);
        
        let record = processedData[key];
        let now = Math.floor(Date.now() / 1000);
        // 10秒内处理过的视为重复
        if (record && (now - record.timestamp) < 10) {
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

// 记录已处理的组合
function recordProcessed(pt_pin, pt_key, wskey) {
    try {
        let processedRaw = $persistentStore.read("JD_Processed_Records");
        let processedData = processedRaw ? JSON.parse(processedRaw) : {};
        
        let key = generateRecordKey(pt_pin, pt_key, wskey);
        processedData[key] = {
            timestamp: Math.floor(Date.now() / 1000),
            requestTime: new Date().toISOString()
        };
        
        // 保留最近20条
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
        
        $persistentStore.write(JSON.stringify(processedData), "JD_Processed_Records");
    } catch (e) {
        console.log("记录处理状态失败: " + e);
    }
}

// 生成记录键
function generateRecordKey(pt_pin, pt_key, wskey) {
    let hash = 0;
    let str = pt_key.substring(0, 16) + wskey.substring(0, 16);
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return pt_pin + "_" + hash.toString(36);
}

// 组合并提交（Loon版）
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

// Loon版本地存储
function saveToLocalStorage(pt_pin, newCookie) {
    try {
        let cookiesListRaw = $persistentStore.read("CookiesJD");
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
        
        $persistentStore.write(JSON.stringify(cookiesList), "CookiesJD");
        console.log(`✅ 成功保存 Cookie 至本地存储`);
    } catch (e) {
        console.log("保存到本地存储时出错: " + e);
    }
}

// Loon版通知
function sendLocalNotification(title, subtitle, message) {
    let fullTitle = `🔵 ${title}`;
    console.log(`${fullTitle} - ${subtitle} - ${message}`);
    $notification.post(fullTitle, subtitle, message);
}

// Loon版API提交
function submitToAPI(pt_pin, pt_key, wskey, cookie) {
    console.log(`正在提交到 API: ${API_URL}`);
    
    const body = JSON.stringify({ 
        pt_key, 
        pt_pin, 
        wskey: wskey || '', 
        cookie 
    });
    
    const request = {
        url: API_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
    };
    
    $httpClient.post(request, function(error, response, data) {
        if (error) {
            console.log(`API提交失败: ${error}`);
            sendLocalNotification("API提交失败", `账号: ${pt_pin}`, error);
            $done({});
            return;
        }
        
        console.log(`API返回状态码: ${response.status}`);
        console.log(`API返回数据: ${data}`);
        
        if (data && (data.includes("ok") || data.includes("成功"))) {
            console.log(`✅ Cookie提交成功`);
            sendLocalNotification("API提交成功", `账号: ${pt_pin}`, "提交成功");
        } else {
            console.log(`❌ API返回失败: ${data}`);
            sendLocalNotification("API提交失败", `账号: ${pt_pin}`, data || "未知错误");
        }
        $done({});
    });
}
