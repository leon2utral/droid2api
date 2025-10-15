import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logDebug, logError, logInfo } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let replacements = {};
let reverseReplacements = {};
let config = { 'res-obfuscation': false };

/**
 * Load control configuration from req.json
 */
function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'req-replace', 'req.json');
    
    if (!fs.existsSync(configPath)) {
      logInfo('req.json not found, using default config (res-obfuscation: false)');
      config = { 'res-obfuscation': false };
      return;
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(fileContent);
    
    if (typeof config['res-obfuscation'] !== 'boolean') {
      config['res-obfuscation'] = false;
    }
    
    logInfo(`Loaded config: res-obfuscation=${config['res-obfuscation']}`);
  } catch (error) {
    logError('Failed to load req.json', error);
    config = { 'res-obfuscation': false };
  }
}

/**
 * Load replacement rules from req-replace.json
 */
export function loadReplacements() {
  try {
    const configPath = path.join(__dirname, 'req-replace', 'req-replace.json');
    
    if (!fs.existsSync(configPath)) {
      logInfo('req-replace.json not found, obfuscation disabled');
      replacements = {};
      reverseReplacements = {};
      return;
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    replacements = JSON.parse(fileContent);
    
    // Build reverse mapping for deobfuscation
    reverseReplacements = {};
    for (const [key, value] of Object.entries(replacements)) {
      reverseReplacements[value] = key;
    }
    
    logInfo(`Loaded ${Object.keys(replacements).length} replacement rules`);
    logDebug('Replacement rules', replacements);
  } catch (error) {
    logError('Failed to load req-replace.json', error);
    replacements = {};
    reverseReplacements = {};
  }
}

/**
 * Obfuscate a string by applying all replacement rules
 * @param {string} str - The string to obfuscate
 * @returns {string} - The obfuscated string
 */
export function obfuscateString(str) {
  if (!str || typeof str !== 'string') {
    return str;
  }
  
  let result = str;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(key).join(value);
  }
  
  return result;
}

/**
 * Deobfuscate a string by applying reverse replacement rules
 * @param {string} str - The string to deobfuscate
 * @returns {string} - The deobfuscated string
 */
export function deobfuscateString(str) {
  if (!str || typeof str !== 'string') {
    return str;
  }
  
  let result = str;
  for (const [key, value] of Object.entries(reverseReplacements)) {
    result = result.split(key).join(value);
  }
  
  return result;
}

/**
 * Obfuscate request body (recursively process objects)
 * @param {any} body - Request body to obfuscate
 * @returns {any} - Obfuscated body
 */
export function obfuscateRequestBody(body) {
  if (Object.keys(replacements).length === 0) {
    return body;
  }
  
  return processObject(body, obfuscateString);
}

/**
 * Deobfuscate response body (recursively process objects)
 * @param {any} body - Response body to deobfuscate
 * @returns {any} - Deobfuscated body
 */
export function deobfuscateResponseBody(body) {
  if (!config['res-obfuscation']) {
    return body;
  }
  
  if (Object.keys(reverseReplacements).length === 0) {
    return body;
  }
  
  return processObject(body, deobfuscateString);
}

/**
 * Recursively process an object, applying the transform function to all string values
 * @param {any} obj - Object to process
 * @param {Function} transformFn - Function to apply to strings
 * @returns {any} - Processed object
 */
function processObject(obj, transformFn) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'string') {
    return transformFn(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => processObject(item, transformFn));
  }
  
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = processObject(value, transformFn);
    }
    return result;
  }
  
  return obj;
}

/**
 * Create a transform stream for SSE responses
 * Deobfuscates each SSE event as it passes through
 */
export class DeobfuscateTransform {
  constructor() {
    this.buffer = '';
  }
  
  /**
   * Process a chunk of SSE data
   * @param {Buffer|string} chunk - The chunk to process
   * @returns {Buffer} - The processed chunk
   */
  transform(chunk) {
    if (!config['res-obfuscation']) {
      return chunk;
    }
    
    if (Object.keys(reverseReplacements).length === 0) {
      return chunk;
    }
    
    const chunkStr = chunk.toString();
    const deobfuscated = deobfuscateString(chunkStr);
    
    return Buffer.from(deobfuscated);
  }
  
  /**
   * Async generator to transform a stream
   * @param {AsyncIterable} stream - The stream to transform
   */
  async *transformStream(stream) {
    for await (const chunk of stream) {
      yield this.transform(chunk);
    }
  }
}

// Load config and replacements on module initialization
loadConfig();
loadReplacements();
