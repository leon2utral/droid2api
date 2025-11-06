import { logInfo, logDebug } from './logger.js';

/**
 * 401 错误追踪器
 * 在内存中存储 401 错误记录，自动清理超过 3 天的记录
 */

// 存储 401 错误记录的数组
let error401Records = [];

// 数据保留时间（3天，单位：毫秒）
const RETENTION_DAYS = 3;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// 自动清理间隔（每小时清理一次）
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 记录一个 401 错误
 * @param {Object} errorInfo - 错误信息
 * @param {string} errorInfo.endpoint - 请求的端点 URL
 * @param {string} errorInfo.method - HTTP 方法
 * @param {string} errorInfo.modelId - 模型 ID
 * @param {string} errorInfo.modelType - 模型类型 (openai/anthropic/common)
 * @param {string} errorInfo.errorDetails - 错误详情
 */
export function record401Error(errorInfo) {
  const record = {
    timestamp: Date.now(),
    timestampISO: new Date().toISOString(),
    endpoint: errorInfo.endpoint || 'unknown',
    method: errorInfo.method || 'POST',
    modelId: errorInfo.modelId || 'unknown',
    modelType: errorInfo.modelType || 'unknown',
    errorDetails: errorInfo.errorDetails || ''
  };

  error401Records.push(record);
  
  logInfo(`401 Error recorded: ${record.method} ${record.endpoint} (Model: ${record.modelId})`);
  logDebug('401 Error details', record);
}

/**
 * 清理超过保留期限的记录
 */
function cleanupOldRecords() {
  const now = Date.now();
  const cutoffTime = now - RETENTION_MS;
  
  const beforeCount = error401Records.length;
  error401Records = error401Records.filter(record => record.timestamp >= cutoffTime);
  const afterCount = error401Records.length;
  
  if (beforeCount > afterCount) {
    logInfo(`Cleaned up ${beforeCount - afterCount} old 401 error records (older than ${RETENTION_DAYS} days)`);
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
 * 获取统计信息
 * @param {string|number} timeRange - 时间范围，可以是 "6h", "12h" 或天数 (1, 2, 3)
 * @returns {Object} 统计信息
 */
export function get401Statistics(timeRange = 1) {
  const records = get401Records(timeRange);

  // 按1分钟分组统计
  const oneMinuteStats = {};
  const modelStats = {};
  const endpointStats = {};

  records.forEach(record => {
    // 按1分钟统计
    const oneMinuteSlot = roundToOneMinute(record.timestamp);
    oneMinuteStats[oneMinuteSlot] = (oneMinuteStats[oneMinuteSlot] || 0) + 1;

    // 按模型统计
    modelStats[record.modelId] = (modelStats[record.modelId] || 0) + 1;

    // 按端点统计
    endpointStats[record.endpoint] = (endpointStats[record.endpoint] || 0) + 1;
  });

  return {
    totalCount: records.length,
    timeRange: {
      range: timeRange,
      from: records.length > 0 ? Math.min(...records.map(r => r.timestamp)) : null,
      to: records.length > 0 ? Math.max(...records.map(r => r.timestamp)) : null
    },
    oneMinuteStats,
    modelStats,
    endpointStats,
    records: records.map(r => ({
      timestamp: r.timestamp,
      timestampISO: r.timestampISO,
      endpoint: r.endpoint,
      method: r.method,
      modelId: r.modelId,
      modelType: r.modelType
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
  return {
    totalRecords: error401Records.length,
    retentionDays: RETENTION_DAYS,
    oldestRecord: error401Records.length > 0 
      ? new Date(Math.min(...error401Records.map(r => r.timestamp))).toISOString()
      : null,
    newestRecord: error401Records.length > 0
      ? new Date(Math.max(...error401Records.map(r => r.timestamp))).toISOString()
      : null
  };
}

