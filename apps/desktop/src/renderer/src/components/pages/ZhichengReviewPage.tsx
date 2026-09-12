/**
 * 职称评审审查页面
 * 
 * 集成到 App.tsx 的主内容区，提供完整的 4 步引导式工作流
 */

import { useState, useEffect } from "react";
import {
  Upload,
  Download,
  UserCheck,
  BarChart3,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Search,
  FileText,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui-shadcn/button";
import { desktopApi } from "../../desktopApi";

export type ZhichengReviewPageProps = {
  className?: string;
  onNavigate?: () => void;
};

type PipelineStep = 1 | 2 | 3 | 4;

type PersonInfo = {
  personId: string;
  personName: string;
  status: "pending" | "done" | "error";
  issuesCount: number;
};

type LedgerRow = {
  person_id: string;
  person_name: string;
  status: "齐全" | "缺件" | "待核实" | "超限" | "部分审查";
  missing_items: string;
  issue_items: string;
};

type AppStatus = {
  downloading: boolean;
  reviewing: boolean;
  currentStep: PipelineStep;
  downloadProgress: number;
  reviewProgress: number;
  csvPath: string | null;
  manifestPath: string | null;
  reportsCount: number;
  ledgerPath: string | null;
  persons: PersonInfo[];
  ledger: LedgerRow[];
};

export function ZhichengReviewPage({ className, onNavigate }: ZhichengReviewPageProps) {
  const [status, setStatus] = useState<AppStatus>({
    downloading: false,
    reviewing: false,
    currentStep: 1,
    downloadProgress: 0,
    reviewProgress: 0,
    csvPath: null,
    manifestPath: null,
    reportsCount: 0,
    ledgerPath: null,
    persons: [],
    ledger: [],
  });

  const [filterStatus, setFilterStatus] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Reset pipeline
  const handleReset = async () => {
    if (!confirm("确定要重置所有数据吗？这将删除所有审查记录。")) return;
    try {
      await desktopApi.zhicheng?.reset?.();
      setStatus(prev => ({
        ...prev,
        currentStep: 1,
        reportsCount: 0,
        persons: [],
        ledger: [],
        downloadProgress: 0,
        reviewProgress: 0,
      }));
    } catch (err) {
      console.error("Reset failed:", err);
      alert("重置失败：" + (err as Error).message);
    }
  };

  // Load status from main process
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const resp = await desktopApi.zhicheng?.checkStatus?.();
      if (resp?.status === "ok") {
        setStatus(prev => ({
          ...prev,
          currentStep: resp.currentStep || 1,
          reportsCount: resp.reportsCount || 0,
          persons: resp.persons || [],
          ledger: resp.ledger || [],
        }));
      }
    } catch (err) {
      console.error("Failed to load status:", err);
    }
  };

  // Step 1: Upload CSV
  const handleUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const content = await file.text();
      try {
        const resp = await desktopApi.zhicheng?.uploadCsv?.({
          path: file.name,
          name: file.name,
          content: content,
        });
        if (resp?.status === "ok") {
          setStatus(prev => ({
            ...prev,
            csvPath: resp.filePath ?? null,
            currentStep: 2,
          }));
        }
      } catch (err) {
        console.error("Upload failed:", err);
      }
    };
    input.click();
  };

  // Step 2: Download
  const handleDownload = async () => {
    if (!status.csvPath) return;

    setStatus(prev => ({ ...prev, downloading: true, downloadProgress: 0 }));

    try {
      const resp = await desktopApi.zhicheng?.download?.({
        csvPath: status.csvPath,
        workers: 8,
        retries: 3,
      });
      if (resp?.status === "ok") {
        setStatus(prev => ({
          ...prev,
          manifestPath: resp.manifestPath ?? null,
          currentStep: 3,
          downloadProgress: 100,
        }));
      }
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setStatus(prev => ({ ...prev, downloading: false }));
    }
  };

  // Step 3: Review
  const handleReview = async (singlePerson?: string) => {
    setStatus(prev => ({ ...prev, reviewing: true, reviewProgress: 0 }));

    try {
      const resp = await desktopApi.zhicheng?.review?.({
        persons: singlePerson ? [singlePerson] : ["all"],
      });
      if (resp?.status === "ok") {
        setStatus(prev => ({
          ...prev,
          currentStep: 4,
          reviewProgress: 100,
          persons: resp.persons || [],
        }));
      }
    } catch (err) {
      console.error("Review failed:", err);
    } finally {
      setStatus(prev => ({ ...prev, reviewing: false }));
    }
  };

  // Step 4: Generate ledger
  const handleGenerateLedger = async () => {
    try {
      const resp = await desktopApi.zhicheng?.ledger?.();
      if (resp?.status === "ok") {
        setStatus(prev => ({
          ...prev,
          ledgerPath: resp.ledgerPath ?? null,
          ledger: resp.ledger || [],
        }));
      }
    } catch (err) {
      console.error("Generate ledger failed:", err);
    }
  };

  // Filter ledger
  const filteredLedger = status.ledger.filter(row => {
    const matchesStatus = !filterStatus || row.status === filterStatus;
    const matchesSearch = !searchTerm || 
      row.person_name?.includes(searchTerm) || 
      row.person_id?.includes(searchTerm);
    return matchesStatus && matchesSearch;
  });

  // Stats
  const stats = {
    total: status.persons.length,
    ok: status.persons.filter(p => p.issuesCount === 0).length,
    issues: status.persons.filter(p => p.issuesCount > 0).length,
  };

  return (
    <div className={cn("flex h-full flex-col bg-gradient-to-b from-background to-muted/10", className)}>
      {/* Header */}
      <div className="page-topbar flex h-16 shrink-0 items-center gap-3 border-b border-border/30 bg-card/90 px-8">
        {onNavigate && (
          <button type="button" onClick={onNavigate} className="flex size-8 items-center justify-center rounded-lg p-0 transition-colors hover:bg-muted" title="返回" style={{ zIndex: 940 as const } as React.CSSProperties}>
            <ArrowLeft className="size-4" />
          </button>
        )}
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
          <UserCheck className="size-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">职称评审材料审查</h1>
          <p className="text-xs text-muted-foreground">逐人审查申报材料，生成标准化审核台账</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
          <RotateCcw className="size-4" />
          重置
        </Button>
      </div>

      {/* Progress Steps */}
      <div className="flex h-16 shrink-0 items-center border-b border-border/30 px-8">
        {[
          { id: 1 as const, label: "上传清单", icon: Upload },
          { id: 2 as const, label: "下载附件", icon: Download },
          { id: 3 as const, label: "审查材料", icon: UserCheck },
          { id: 4 as const, label: "查看结果", icon: BarChart3 },
        ].map((step, idx) => {
          const isActive = status.currentStep === step.id;
          const isCompleted = status.currentStep > step.id;
          const Icon = step.icon;

          return (
            <div key={step.id} className="flex flex-1 items-center">
              <div className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 transition-all",
                isActive && "bg-primary/10 ring-2 ring-primary/30",
                isCompleted && "bg-primary/5",
              )}>
                <div className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-medium text-white",
                  isActive && "bg-primary",
                  isCompleted && "bg-primary/70",
                  !isActive && !isCompleted && "bg-muted-foreground/30",
                )}>
                  {isCompleted ? (
                    <CheckCircle className="size-4" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </div>
                <span className={cn(
                  "text-sm font-medium",
                  isActive && "text-primary",
                  isCompleted && "text-muted-foreground",
                  !isActive && !isCompleted && "text-muted-foreground/60",
                )}>
                  {step.label}
                </span>
              </div>
              {idx < 3 && (
                <div className={cn(
                  "ml-4 flex-1 h-px",
                  isCompleted ? "bg-primary/40" : "bg-muted",
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto p-8">
        {status.currentStep === 1 && (
          <Step1Upload onUpload={handleUpload} csvPath={status.csvPath} />
        )}
        {status.currentStep === 2 && (
          <Step2Download 
            csvPath={status.csvPath}
            onDownload={handleDownload}
            downloading={status.downloading}
            progress={status.downloadProgress}
          />
        )}
        {status.currentStep === 3 && (
          <Step3Review 
            persons={status.persons}
            onReview={handleReview}
            reviewing={status.reviewing}
          />
        )}
        {status.currentStep === 4 && (
          <Step4Result 
            ledger={status.ledger}
            onGenerateLedger={handleGenerateLedger}
            filterStatus={filterStatus}
            onFilterStatus={setFilterStatus}
            searchTerm={searchTerm}
            onSearchTerm={setSearchTerm}
            filteredLedger={filteredLedger}
            stats={stats}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1: Upload CSV ──
function Step1Upload({ onUpload, csvPath }: {
  onUpload: () => void;
  csvPath: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-semibold">上传申报清单</h2>
        <p className="text-lg text-muted-foreground">选择申报清单文件，系统将自动识别列并预览</p>
      </div>
      <Button 
        onClick={onUpload} 
        size="lg"
        className="gap-2"
      >
        <Upload className="size-5" />
        选择文件
      </Button>
      {csvPath && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" />
          已加载：{csvPath.split("/").pop()}
        </div>
      )}
      <div className="mt-8 grid max-w-2xl grid-cols-3 gap-4 text-center">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Step 2</p>
          <p className="text-xs text-muted-foreground">下载附件</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Step 3</p>
          <p className="text-xs text-muted-foreground">审查材料</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Step 4</p>
          <p className="text-xs text-muted-foreground">查看结果</p>
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Download ──
function Step2Download({ csvPath, onDownload, downloading, progress }: {
  csvPath: string | null;
  onDownload: () => void;
  downloading: boolean;
  progress: number;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8">
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-semibold">下载附件</h2>
        <p className="text-lg text-muted-foreground">从 OSS 下载所有 PDF 材料到本地</p>
      </div>
      <Button 
        onClick={onDownload} 
        size="lg"
        disabled={downloading || !csvPath}
        className="gap-2"
      >
        {downloading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <Download className="size-5" />
        )}
        {downloading ? "下载中..." : "开始下载"}
      </Button>
      {downloading && (
        <div className="w-full max-w-md space-y-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div 
              className="h-full bg-primary transition-all duration-300" 
              style={{ width: `${progress}%` }} 
            />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            下载进度：{progress}%
          </p>
        </div>
      )}
      <div className="mt-8 grid max-w-2xl grid-cols-3 gap-4 text-center">
        <div className="rounded-lg border bg-primary/5 p-4">
          <CheckCircle className="mx-auto mb-2 size-6 text-primary" />
          <p className="text-sm font-medium">✓ 上传清单</p>
        </div>
        <div className="rounded-lg border p-4">
          <Loader2 className="mx-auto mb-2 size-6 animate-spin text-primary" />
          <p className="text-sm font-medium">下载附件</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">审查材料</p>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Review ──
function Step3Review({ persons, onReview, reviewing }: {
  persons: PersonInfo[];
  onReview: (personId?: string) => void;
  reviewing: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">材料审查</h2>
          <p className="text-muted-foreground">逐人对照 19 项审核要点进行检查</p>
        </div>
        <Button 
          onClick={() => onReview()}
          disabled={reviewing}
          size="lg"
          className="gap-2"
        >
          {reviewing ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <UserCheck className="size-5" />
          )}
          {reviewing ? "审查中..." : "开始审查"}
        </Button>
      </div>

      {/* Person List */}
      <div className="flex-1 overflow-auto rounded-xl border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <th className="px-6 py-4 text-left font-medium">序号</th>
              <th className="px-6 py-4 text-left font-medium">姓名</th>
              <th className="px-6 py-4 text-left font-medium">身份证</th>
              <th className="px-6 py-4 text-left font-medium">状态</th>
              <th className="px-6 py-4 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {persons.map((person, idx) => (
              <tr key={person.personId} className="border-b hover:bg-muted/50">
                <td className="px-6 py-4 text-muted-foreground">{idx + 1}</td>
                <td className="px-6 py-4 font-medium">{person.personName}</td>
                <td className="px-6 py-4 font-mono text-xs">{person.personId}</td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
                    person.status === "done" && "bg-green-100 text-green-800",
                    person.status === "error" && "bg-red-100 text-red-800",
                    person.status === "pending" && "bg-muted text-muted-foreground",
                  )}>
                    {person.status === "done" ? "已完成" :
                     person.status === "error" ? "失败" : "待审查"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  {person.status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReview(person.personId)}
                      disabled={reviewing}
                    >
                      审查
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Step 4: Results ──
function Step4Result({ 
  ledger, 
  onGenerateLedger, 
  filterStatus, 
  onFilterStatus, 
  searchTerm, 
  onSearchTerm, 
  filteredLedger,
  stats 
}: {
  ledger: LedgerRow[];
  onGenerateLedger: () => void;
  filterStatus: string | null;
  onFilterStatus: (status: string | null) => void;
  searchTerm: string;
  onSearchTerm: (term: string) => void;
  filteredLedger: LedgerRow[];
  stats: { total: number; ok: number; issues: number };
}) {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">审核结果</h2>
          <p className="text-muted-foreground">筛选、查看、导出审核台账</p>
        </div>
        <Button 
          onClick={onGenerateLedger}
          variant="outline"
          size="lg"
          className="gap-2"
        >
          <BarChart3 className="size-5" />
          生成台账
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-6">
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">总人数</p>
          <p className="text-3xl font-semibold">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-green-200 p-6">
          <p className="text-sm text-muted-foreground">齐全</p>
          <p className="text-3xl font-semibold text-green-600">{stats.ok}</p>
        </div>
        <div className="rounded-xl border border-amber-200 p-6">
          <p className="text-sm text-muted-foreground">有疑点</p>
          <p className="text-3xl font-semibold text-amber-600">{stats.issues}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <select
          value={filterStatus || ""}
          onChange={(e) => onFilterStatus(e.target.value || null)}
          className="rounded-lg border px-4 py-2 text-sm"
        >
          <option value="">全部状态</option>
          {["齐全", "缺件", "待核实", "超限", "部分审查"].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索姓名或身份证号..."
            value={searchTerm}
            onChange={(e) => onSearchTerm(e.target.value)}
            className="w-full rounded-lg border pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Ledger Table */}
      <div className="flex-1 overflow-auto rounded-xl border bg-card">
        {filteredLedger.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                <th className="px-6 py-4 text-left font-medium">姓名</th>
                <th className="px-6 py-4 text-left font-medium">身份证</th>
                <th className="px-6 py-4 text-left font-medium">状态</th>
                <th className="px-6 py-4 text-left font-medium">缺件</th>
                <th className="px-6 py-4 text-left font-medium">疑点</th>
                <th className="px-6 py-4 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredLedger.map((row, idx) => (
                <tr key={idx} className="border-b hover:bg-muted/50">
                  <td className="px-6 py-4 font-medium">{row.person_name}</td>
                  <td className="px-6 py-4 font-mono text-xs">{row.person_id}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
                      row.status === "齐全" && "bg-green-100 text-green-800",
                      row.status === "缺件" && "bg-red-100 text-red-800",
                      row.status === "待核实" && "bg-amber-100 text-amber-800",
                      row.status === "超限" && "bg-orange-100 text-orange-800",
                    )}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">{row.missing_items || "-"}</td>
                  <td className="px-6 py-4 text-sm">{row.issue_items || "-"}</td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            {ledger.length === 0 ? "暂无数据，请先生成台账" : "无匹配数据"}
          </div>
        )}
      </div>
    </div>
  );
}