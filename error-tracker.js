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
 * @param {number} days - 查询最近几天的记录 (1, 2, 或 3)
 * @returns {Array} 错误记录数组
 */
export function get401Records(days = 3) {
  // 确保 days 在有效范围内
  const validDays = Math.min(Math.max(1, days), RETENTION_DAYS);
  
  const now = Date.now();
  const cutoffTime = now - (validDays * 24 * 60 * 60 * 1000);
  
  const records = error401Records.filter(record => record.timestamp >= cutoffTime);
  
  logDebug(`Retrieved ${records.length} 401 error records for last ${validDays} day(s)`);
  
  return records;
}

/**
 * 将时间戳向下取整到最近的5分钟
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {string} ISO格式的5分钟时间槽
 */
function roundToFiveMinutes(timestamp) {
  const date = new Date(timestamp);
  const minutes = date.getMinutes();
  const roundedMinutes = Math.floor(minutes / 5) * 5;

  date.setMinutes(roundedMinutes);
  date.setSeconds(0);
  date.setMilliseconds(0);

  return date.toISOString();
}

/**
 * 获取统计信息
 * @param {number} days - 统计最近几天的数据
 * @returns {Object} 统计信息
 */
export function get401Statistics(days = 3) {
  const records = get401Records(days);

  // 按5分钟分组统计
  const fiveMinuteStats = {};
  const modelStats = {};
  const endpointStats = {};

  records.forEach(record => {
    // 按5分钟统计
    const fiveMinuteSlot = roundToFiveMinutes(record.timestamp);
    fiveMinuteStats[fiveMinuteSlot] = (fiveMinuteStats[fiveMinuteSlot] || 0) + 1;

    // 按模型统计
    modelStats[record.modelId] = (modelStats[record.modelId] || 0) + 1;

    // 按端点统计
    endpointStats[record.endpoint] = (endpointStats[record.endpoint] || 0) + 1;
  });

  return {
    totalCount: records.length,
    timeRange: {
      days: days,
      from: records.length > 0 ? Math.min(...records.map(r => r.timestamp)) : null,
      to: records.length > 0 ? Math.max(...records.map(r => r.timestamp)) : null
    },
    fiveMinuteStats,
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

