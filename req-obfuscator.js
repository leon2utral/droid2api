import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logDebug, logError, logInfo } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let requestReplacements = {};
let responseReplacements = {};

/**
 * Load replacement rules from req-replace.json
 */
export function loadReplacements() {
  try {
    const configPath = path.join(__dirname, 'req-replace', 'req-replace.json');
    
    if (!fs.existsSync(configPath)) {
      logInfo('req-replace.json not found, obfuscation disabled');
      requestReplacements = {};
      responseReplacements = {};
      return;
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(fileContent);
    
    if (!config.rules || !Array.isArray(config.rules)) {
      logError('Invalid req-replace.json format: rules array not found');
      requestReplacements = {};
      responseReplacements = {};
      return;
    }
    
    // Build request replacements (active rules only)
    requestReplacements = {};
    let activeCount = 0;
    
    for (const ruleObj of config.rules) {
      const active = ruleObj.active !== false; // default true
      
      if (active && ruleObj.rule && typeof ruleObj.rule === 'object') {
        for (const [key, value] of Object.entries(ruleObj.rule)) {
          requestReplacements[key] = value;
        }
        activeCount++;
      }
    }
    
    // Build response replacements (active rules with res-obfs=true only)
    responseReplacements = {};
    let resObfsCount = 0;
    
    for (const ruleObj of config.rules) {
      const active = ruleObj.active !== false; // default true
      const resObfs = ruleObj['res-obfs'] === true; // default false
      
      if (active && resObfs && ruleObj.rule && typeof ruleObj.rule === 'object') {
        // For response, we need reverse mapping: value -> key
        for (const [key, value] of Object.entries(ruleObj.rule)) {
          responseReplacements[value] = key;
        }
        resObfsCount++;
      }
    }
    
    logInfo(`Loaded ${activeCount} active request rules, ${resObfsCount} response deobfuscation rules`);
    logDebug('Request replacement rules', requestReplacements);
    logDebug('Response replacement rules', responseReplacements);
  } catch (error) {
    logError('Failed to load req-replace.json', error);
    requestReplacements = {};
    responseReplacements = {};
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
  for (const [key, value] of Object.entries(requestReplacements)) {
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
  for (const [key, value] of Object.entries(responseReplacements)) {
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
  if (Object.keys(requestReplacements).length === 0) {
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
  if (Object.keys(responseReplacements).length === 0) {
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
    if (Object.keys(responseReplacements).length === 0) {
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

// Load replacements on module initialization
loadReplacements();
