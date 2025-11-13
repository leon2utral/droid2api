import { logInfo, logDebug } from './logger.js';
import crypto from 'crypto';

/**
 * 401 错误追踪器
 * 在内存中存储 401 错误记录，自动清理超过 3 天的记录
 * 优化：只统计每个key首次出现401的时间点，避免重复统计造成的数据污染
 */

// 存储 401 错误记录的数组
let error401Records = [];

// 存储已失效的key集合（用于去重）
const failedKeysSet = new Set();

// 数据保留时间（15天，单位：毫秒）
const RETENTION_DAYS = 15;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// 自动清理间隔（每小时清理一次）
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 生成key的hash标识（用于去重，保护隐私）
 * @param {string} apiKey - API密钥
 * @returns {string} - Hash值（SHA256前12位）
 */
function generateKeyHash(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return 'unknown';
  }
  
  // 移除 "Bearer " 前缀（如果存在）
  const key = apiKey.replace(/^Bearer\s+/i, '').trim();
  
  if (!key) {
    return 'unknown';
  }
  
  // 生成SHA256 hash，取前12位
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return hash.substring(0, 12);
}

/**
 * 记录一个 401 错误
 * @param {Object} errorInfo - 错误信息
 * @param {string} errorInfo.endpoint - 请求的端点 URL
 * @param {string} errorInfo.method - HTTP 方法
 * @param {string} errorInfo.modelId - 模型 ID
 * @param {string} errorInfo.modelType - 模型类型 (openai/anthropic/common)
 * @param {string} errorInfo.errorDetails - 错误详情
 * @param {string} errorInfo.apiKey - API密钥（用于去重识别）
 */
export function record401Error(errorInfo) {
  const now = Date.now();
  const keyHash = generateKeyHash(errorInfo.apiKey);
  
  // 检查是否为首次失效
  const isFirstFail = !failedKeysSet.has(keyHash);
  
  // 记录到失效集合
  if (isFirstFail) {
    failedKeysSet.add(keyHash);
  }
  
  const record = {
    timestamp: now,
    timestampISO: new Date().toISOString(),
    endpoint: errorInfo.endpoint || 'unknown',
    method: errorInfo.method || 'POST',
    modelId: errorInfo.modelId || 'unknown',
    modelType: errorInfo.modelType || 'unknown',
    errorDetails: errorInfo.errorDetails || '',
    keyHash: keyHash,           // 保存key hash（隐私保护）
    isFirstFail: isFirstFail    // 标记是否为首次失效
  };

  error401Records.push(record);
  
  if (isFirstFail) {
    logInfo(`🔴 401 Error (FIRST FAIL): ${record.method} ${record.endpoint} (Model: ${record.modelId}, Key: ${keyHash})`);
  } else {
    logInfo(`🟠 401 Error (repeated): ${record.method} ${record.endpoint} (Model: ${record.modelId}, Key: ${keyHash})`);
  }
  logDebug('401 Error details', record);
}

/**
 * 清理超过保留期限的记录
 */
function cleanupOldRecords() {
  const now = Date.now();
  const cutoffTime = now - RETENTION_MS;
  
  const beforeCount = error401Records.length;
  
  // 清理旧记录
  error401Records = error401Records.filter(record => record.timestamp >= cutoffTime);
  
  const afterCount = error401Records.length;
  
  // 同步清理失效key集合：如果某个key的所有记录都被清理了，则从集合中移除
  if (beforeCount > afterCount) {
    // 重建失效key集合（只保留当前记录中存在的key）
    const currentKeyHashes = new Set(error401Records.map(r => r.keyHash));
    
    // 从failedKeysSet中移除不再存在于记录中的key
    const keysToRemove = [];
    for (const keyHash of failedKeysSet) {
      if (!currentKeyHashes.has(keyHash)) {
        keysToRemove.push(keyHash);
      }
    }
    
    keysToRemove.forEach(keyHash => failedKeysSet.delete(keyHash));
    
    logInfo(`Cleaned up ${beforeCount - afterCount} old 401 error records and ${keysToRemove.length} expired keys (older than ${RETENTION_DAYS} days)`);
  }
}

/**
 * 获取指定时间范围内的 401 错误记录
 * @param {string|number} timeRange - 时间范围，可以是 "6h", "12h" 或天数 (1, 2, 3)
 * @returns {Array} 错误记录数组
 */
export function get401Records(timeRange = 1) {
  const now = Date.now();
  let cutoffTime;
  let rangeDescription;

  // 解析时间范围
  if (typeof timeRange === 'string' && timeRange.endsWith('h')) {
    // 小时格式，如 "6h", "12h"
    const hours = parseInt(timeRange);
    cutoffTime = now - (hours * 60 * 60 * 1000);
    rangeDescription = `${hours} hour(s)`;
  } else {
    // 天数格式
    const days = Math.min(Math.max(1, parseInt(timeRange)), RETENTION_DAYS);
    cutoffTime = now - (days * 24 * 60 * 60 * 1000);
    rangeDescription = `${days} day(s)`;
  }

  const records = error401Records.filter(record => record.timestamp >= cutoffTime);

  logDebug(`Retrieved ${records.length} 401 error records for last ${rangeDescription}`);

  return records;
}

/**
 * 将时间戳向下取整到最近的1分钟
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} ISO格式的1分钟时间槽
 */
function roundToOneMinute(timestamp) {
  const date = new Date(timestamp);

  date.setSeconds(0);
  date.setMilliseconds(0);

  return date.toISOString();
}

/**
 * 将时间戳转换为北京时间的日期和分钟索引
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {Object} {date: 'YYYY-MM-DD', minuteOfDay: 0-1439, timeStr: 'HH:MM'}
 */
function toBeijingTimeMinute(timestamp) {
  // 北京时间是 UTC+8
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(timestamp + beijingOffset);
  
  // 获取 UTC 形式的日期（实际是北京时间）
  const year = beijingTime.getUTCFullYear();
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getUTCDate()).padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  
  const hour = beijingTime.getUTCHours();
  const minute = beijingTime.getUTCMinutes();
  const minuteOfDay = hour * 60 + minute; // 0-1439
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  
  return { date, minuteOfDay, timeStr, hour, minute };
}

/**
 * 获取按北京时间 0-24 小时分布的统计信息
 * @param {string|number} timeRange - 时间范围，天数 (1, 3, 7, 15)
 * @param {boolean} onlyFirstFail - 是否只统计首次401
 * @returns {Object} 按北京时间分布的统计信息
 */
function getBeijingTimeDistribution(timeRange = 1, onlyFirstFail = false) {
  const allRecords = get401Records(timeRange);
  
  // 根据参数决定使用哪些记录
  const records = onlyFirstFail 
    ? allRecords.filter(r => r.isFirstFail === true)
    : allRecords;
  
  // 按日期分组统计
  const byDate = {};
  
  records.forEach(record => {
    const { date, minuteOfDay } = toBeijingTimeMinute(record.timestamp);
    
    if (!byDate[date]) {
      byDate[date] = new Array(1440).fill(0); // 1440 分钟 = 24 小时 * 60 分钟
    }
    
    byDate[date][minuteOfDay]++;
  });
  
  // 转换为前端需要的格式
  const dateList = Object.keys(byDate).sort(); // 按日期排序
  const distributionData = dateList.map(date => ({
    date,
    distribution: byDate[date]
  }));
  
  return {
    dateList,
    distributionData
  };
}

/**
 * 获取统计信息
 * @param {string|number} timeRange - 时间范围，可以是 "6h", "12h" 或天数 (1, 2, 3, 7, 15)
 * @param {boolean} onlyFirstFail - 是否只统计首次401（默认false，统计所有）
 * @returns {Object} 统计信息
 */
export function get401Statistics(timeRange = 1, onlyFirstFail = false) {
  const allRecords = get401Records(timeRange);
  
  // 根据参数决定使用哪些记录进行统计
  const records = onlyFirstFail 
    ? allRecords.filter(r => r.isFirstFail === true)
    : allRecords;

  // 按1分钟分组统计
  const oneMinuteStats = {};
  const modelStats = {};
  const endpointStats = {};
  const keyStats = {};

  records.forEach(record => {
    // 按1分钟统计
    const oneMinuteSlot = roundToOneMinute(record.timestamp);
    oneMinuteStats[oneMinuteSlot] = (oneMinuteStats[oneMinuteSlot] || 0) + 1;

    // 按模型统计
    modelStats[record.modelId] = (modelStats[record.modelId] || 0) + 1;

    // 按端点统计
    endpointStats[record.endpoint] = (endpointStats[record.endpoint] || 0) + 1;
    
    // 按key统计（只统计首次失效）
    if (record.isFirstFail && record.keyHash && record.keyHash !== 'unknown') {
      keyStats[record.keyHash] = {
        firstFailTime: record.timestamp,
        firstFailTimeISO: record.timestampISO,
        modelId: record.modelId,
        endpoint: record.endpoint
      };
    }
  });

  // 获取北京时间分布数据（仅用于天数范围）
  let beijingTimeDistribution = null;
  if (typeof timeRange === 'number' || (typeof timeRange === 'string' && !timeRange.endsWith('h'))) {
    beijingTimeDistribution = getBeijingTimeDistribution(timeRange, onlyFirstFail);
  }

  // 统计首次失效和重复失效的数量
  const firstFailCount = allRecords.filter(r => r.isFirstFail === true).length;
  const repeatFailCount = allRecords.filter(r => r.isFirstFail === false).length;

  return {
    totalCount: records.length,
    allRecordsCount: allRecords.length,  // 所有401记录数
    firstFailCount: firstFailCount,       // 首次401数量
    repeatFailCount: repeatFailCount,     // 重复401数量
    uniqueFailedKeys: Object.keys(keyStats).length, // 失效key数量
    filterMode: onlyFirstFail ? 'first-fail-only' : 'all',
    timeRange: {
      range: timeRange,
      from: records.length > 0 ? Math.min(...records.map(r => r.timestamp)) : null,
      to: records.length > 0 ? Math.max(...records.map(r => r.timestamp)) : null
    },
    oneMinuteStats,
    modelStats,
    endpointStats,
    keyStats,
    beijingTimeDistribution,
    records: records.map(r => ({
      timestamp: r.timestamp,
      timestampISO: r.timestampISO,
      endpoint: r.endpoint,
      method: r.method,
      modelId: r.modelId,
      modelType: r.modelType,
      keyHash: r.keyHash,
      isFirstFail: r.isFirstFail
    }))
  };
}

/**
 * 初始化错误追踪器
 * 启动定期清理任务
 */
export function initializeErrorTracker() {
  logInfo('Initializing 401 error tracker...');
  
  // 立即执行一次清理
  cleanupOldRecords();
  
  // 设置定期清理任务
  setInterval(() => {
    cleanupOldRecords();
  }, CLEANUP_INTERVAL_MS);
  
  logInfo(`401 error tracker initialized (retention: ${RETENTION_DAYS} days, cleanup interval: ${CLEANUP_INTERVAL_MS / 1000 / 60} minutes)`);
}

/**
 * 获取追踪器状态信息
 */
export function getTrackerStatus() {
  const firstFailRecords = error401Records.filter(r => r.isFirstFail === true);
  
  return {
    totalRecords: error401Records.length,
    firstFailRecords: firstFailRecords.length,
    repeatFailRecords: error401Records.length - firstFailRecords.length,
    uniqueFailedKeys: failedKeysSet.size,
    retentionDays: RETENTION_DAYS,
    oldestRecord: error401Records.length > 0 
      ? new Date(Math.min(...error401Records.map(r => r.timestamp))).toISOString()
      : null,
    newestRecord: error401Records.length > 0
      ? new Date(Math.max(...error401Records.map(r => r.timestamp))).toISOString()
      : null
  };
}

