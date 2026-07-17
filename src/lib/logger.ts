// Diagnostic Logging System for Kora Reader
// Captures system operations, downloads, errors, and mirror details.

export interface LogEntry {
  timestamp: string;
  type: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

const MAX_LOGS = 300;
const STORAGE_KEY = "kora_diagnostic_logs";

class DiagnosticLogger {
  private logs: LogEntry[] = [];
  private listeners: (() => void)[] = [];

  constructor() {
    this.loadLogs();
    this.setupGlobalHandlers();
  }

  private loadLogs() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored);
      }
    } catch (e) {
      this.logs = [];
    }
    
    // Add init log
    this.addLog("info", "Diagnostic log session initialized");
  }

  private saveLogs() {
    try {
      // Keep only last MAX_LOGS
      if (this.logs.length > MAX_LOGS) {
        this.logs = this.logs.slice(-MAX_LOGS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch (e) {
      // Ignore storage errors
    }
    this.notify();
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public addLog(type: "info" | "warn" | "error", message: string, detail?: any) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
      detail: detail ? (typeof detail === "object" ? JSON.stringify(detail, null, 2) : String(detail)) : undefined
    };
    
    this.logs.push(entry);
    this.saveLogs();
  }

  public getLogs(): LogEntry[] {
    return [...this.logs];
  }

  public clear() {
    this.logs = [{
      timestamp: new Date().toISOString(),
      type: "info",
      message: "Logs cleared by user"
    }];
    this.saveLogs();
  }

  private setupGlobalHandlers() {
    if (typeof window === "undefined") return;

    // Capture unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      this.addLog(
        "error",
        `Unhandled Promise Rejection: ${event.reason?.message || event.reason}`,
        event.reason?.stack || event.reason
      );
    });

    // Capture general runtime errors
    window.addEventListener("error", (event) => {
      this.addLog(
        "error",
        `Runtime Error: ${event.message} at ${event.filename}:${event.lineno}`,
        event.error?.stack
      );
    });

    // Intercept standard console.error and console.warn gently (without breaking the original console)
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      const message = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
      // Avoid infinite loop if logger itself fails
      if (!message.includes(STORAGE_KEY)) {
        this.addLog("error", `Console error: ${message}`);
      }
    };

    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      const message = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ");
      if (!message.includes(STORAGE_KEY)) {
        this.addLog("warn", `Console warn: ${message}`);
      }
    };
  }

  public downloadLogsAsFile() {
    const logsText = this.logs
      .map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}${l.detail ? `\nDetail: ${l.detail}` : ""}`)
      .join("\n\n");
    
    const blob = new Blob([logsText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kora-diagnostic-logs-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const logger = new DiagnosticLogger();
