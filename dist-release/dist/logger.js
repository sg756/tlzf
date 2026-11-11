"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
exports.initLogger = initLogger;
exports.currentLogFile = currentLogFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const util = __importStar(require("util"));
let logDir = path.resolve(process.cwd(), 'logs');
function initLogger(dir) {
    const fromEnv = (process.env.LOG_DIR || '').trim();
    logDir = path.resolve(dir || fromEnv || path.join(process.cwd(), 'logs'));
    fs.mkdirSync(logDir, { recursive: true });
    return currentLogFile();
}
function currentLogFile() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return path.join(logDir, `arb-${y}-${m}-${day}.log`);
}
function ts() {
    return new Date().toISOString();
}
function formatExtra(extra) {
    if (extra === undefined)
        return '';
    if (typeof extra === 'string')
        return ` ${extra}`;
    return ` ${util.inspect(extra, { depth: 6, breakLength: 200, compact: true })}`;
}
function write(level, msg, extra) {
    const line = `${ts()} [${level}] ${msg}${formatExtra(extra)}`;
    if (level === 'WARN')
        console.warn(line);
    else if (level === 'ERROR')
        console.error(line);
    else
        console.log(line);
    try {
        fs.appendFileSync(currentLogFile(), `${line}\n`, 'utf8');
    }
    catch {
        /* 写文件失败时仍保留控制台 */
    }
}
exports.log = {
    info(msg, extra) {
        write('INFO', msg, extra);
    },
    warn(msg, extra) {
        write('WARN', msg, extra);
    },
    error(msg, extra) {
        write('ERROR', msg, extra);
    },
};
//# sourceMappingURL=logger.js.map