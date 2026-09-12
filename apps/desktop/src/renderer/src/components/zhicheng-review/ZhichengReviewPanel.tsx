/**
 * 职称评审材料审查面板
 * 
 * 集成方式：在 workspace 中使用，作为独立页面或面板
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
  Filter,
  FileText,
  ChevronRight,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui-shadcn/button";
import { Input } from "./ui-shadcn/input";
import { Badge } from "./ui-shadcn/badge";

export type ZhichengReviewPanelProps = {
  className?: string;
};

// 步骤数据
const STEPS = [
  { id: 1, label: "上传清单", icon: Upload, desc: "CSV + 列映射" },
  { id: 2, label: "下载附件", icon: Download, desc: "PDF 到本地" },
  { id: 3, label: "审查材料", icon: UserCheck, desc: "19 项检查" },
  { id: 4, label: "查看结果", icon: BarChart3, desc: "台账/筛选" },
];

type PipelineStatus = {
  downloading: boolean;
  reviewing: boolean;
  currentStep: number;
  downloadProgress: number; // 0-100
  reviewProgress: number;   // 0-100
  csvPath: string | null;
  manifestPath: string | null;
  reportsCount: number;
  ledgerPath: string | null;
  persons: PersonInfo[];
  ledger: LedgerRow[];
};

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

export function ZhichengReviewPanel({ className }: ZhichengReviewPanelProps) {
  const [status, setStatus] = useState<PipelineStatus>({
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

  // 加载磁盘数据
  useEffect(() => {
    loadFromDisk();
  }, []);

  const loadFromDisk = async () => {
    try {
      // 检查 manifest.csv 是否存在
      const resp = await fetch("/api/zhicheng/check-status");
      const data = await resp.json();
      if (data.status === "ok") {
        setStatus(prev => ({
          ...prev,
          currentStep: data.currentStep || 1,
          reportsCount: data.reportsCount || 0,
          persons: data.persons || [],
          ledger: data.ledger || [],
        }));
      }
    } catch {
      // No data
    }
  };

  // Step 1: 上传 CSV
  const handleUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // 上传 CSV 并获取列映射
      const formData = new FormData();
      formData.append("file", file);
      formData.append("step", "upload");

      try {
        const resp = await fetch("/api/zhicheng/upload-csv", {
          method: "POST",
          body: formData,
        });
        const data = await resp.json();
        if (data.status === "ok") {
          setStatus(prev => ({
            ...prev,
            csvPath: data.filePath,
            currentStep: 2,
          }));
        }
      } catch (err) {
        console.error("Upload failed:", err);
      }
    };
    input.click();
  };

  // Step 2: 下载附件
  const handleDownload = async () => {
    setStatus(prev => ({ ...prev, downloading: true, downloadProgress: 0 }));

    try {
      const resp = await fetch("/api/zhicheng/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvPath: status.csvPath,
          workers: 8,
          retries: 3,
        }),
      });
      const data = await resp.json();
      if (data.status === "ok") {
        setStatus(prev => ({
          ...prev,
          manifestPath: data.manifestPath,
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

  // Step 3: 开始审查
  const handleReview = async (singlePerson?: string) => {
    setStatus(prev => ({ ...prev, reviewing: true, reviewProgress: 0 }));

    try {
      const resp = await fetch("/api/zhicheng/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persons: singlePerson ? [singlePerson] : ["all"],
        }),
      });
      const data = await resp.json();
      if (data.status === "ok") {
        setStatus(prev => ({
          ...prev,
          currentStep: 4,
          reviewProgress: 100,
          persons: data.persons || [],
        }));
      }
    } catch (err) {
      console.error("Review failed:", err);
    } finally {
      setStatus(prev => ({ ...prev, reviewing: false }));
    }
  };

  // Step 4: 生成台账
  const handleGenerateLedger = async () => {
    try {
      const resp = await fetch("/api/zhicheng/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await resp.json();
      if (data.status === "ok") {
        setStatus(prev => ({
          ...prev,
          ledgerPath: data.ledgerPath,
          ledger: data.ledger || [],
        }));
      }
    } catch (err) {
      console.error("Generate ledger failed:", err);
    }
  };

  // 筛选台账
  const filteredLedger = status.ledger.filter(row => {
    const matchesStatus = !filterStatus || row.status === filterStatus;
    const matchesSearch = !searchTerm || 
      row.person_name?.includes(searchTerm) || 
      row.person_id?.includes(searchTerm);
    return matchesStatus && matchesSearch;
  });

  // 统计
  const stats = {
    total: status.persons.length,
    ok: status.persons.filter(p => p.issuesCount === 0).length,
    issues: status.persons.filter(p => p.issuesCount > 0).length,
  };

  return (
    <div className={cn("flex h-full flex-col bg-background", className)}>
      {/* Step Progress Bar */}
      <div className="flex h-14 shrink-0 items-center border-b border-border/40 px-6">
        {STEPS.map((step, idx) => {
          const isActive = status.currentStep === step.id;
          const isCompleted = status.currentStep > step.id;
          const Icon = step.icon;

          return (
            <div key={step.id} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white transition-all",
                  isActive && "bg-primary ring-2 ring-primary/30",
                  isCompleted && "bg-primary/80",
                  !isActive && !isCompleted && "bg-muted-foreground/30",
                )}>
                  {isCompleted ? <CheckCircle className="size-4" /> : <Icon className="size-4" />}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className={cn(
                    "text-xs font-medium",
                    isActive && "text-foreground",
                    isCompleted && "text-muted-foreground",
                    !isActive && !isCompleted && "text-muted-foreground/60",
                  )}>
                    {step.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{step.desc}</span>
                </div>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={cn(
                  "ml-4 flex-1 h-0.5",
                  isCompleted ? "bg-primary/40" : "bg-muted",
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto p-6">
        {status.currentStep === 1 && (
          <Step1Upload 
            onUpload={handleUpload} 
            csvPath={status.csvPath}
          />
        )}
        {status.currentStep === 2 && (
          <Step2Download 
            csvPath={status.csvPath}
            onDownload={handleDownload}
            downloading={status.downloading}
            progress={status.downloadProgress}
            manifestPath={status.manifestPath}
          />
        )}
        {status.currentStep === 3 && (
          <Step3Review 
            persons={status.persons}
            onReview={handleReview}
            reviewing={status.reviewing}
            progress={status.reviewProgress}
          />
        )}
        {status.currentStep === 4 && (
          <Step4Result 
            persons={status.persons}
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
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">上传申报清单</h2>
        <p className="text-muted-foreground">选择 CSV 文件，系统将自动识别列并预览</p>
      </div>
      <Button 
        onClick={onUpload} 
        size="lg"
        className="gap-2"
      >
        <Upload className="size-5" />
        选择 CSV 文件
      </Button>
      {csvPath && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" />
          已加载：{csvPath.split("/").pop()}
        </div>
      )}
    </div>
  );
}

// ── Step 2: Download ──
function Step2Download({ csvPath, onDownload, downloading, progress, manifestPath }: {
  csvPath: string | null;
  onDownload: () => void;
  downloading: boolean;
  progress: number;
  manifestPath: string | null;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">下载附件</h2>
        <p className="text-muted-foreground">从 OSS 下载所有 PDF 材料到本地</p>
      </div>
      {progress < 100 ? (
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
      ) : (
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle className="size-6" />
          <span>下载完成</span>
        </div>
      )}
      {downloading && (
        <div className="w-full max-w-md space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div 
              className="h-full bg-primary transition-all" 
              style={{ width: `${progress}%` }} 
            />
          </div>
          <p className="text-center text-sm text-muted-foreground">{progress}%</p>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Review ──
function Step3Review({ persons, onReview, reviewing, progress }: {
  persons: PersonInfo[];
  onReview: (personId?: string) => void;
  reviewing: boolean;
  progress: number;
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">材料审查</h2>
          <p className="text-sm text-muted-foreground">逐人对照 19 项审核要点进行检查</p>
        </div>
        <Button 
          onClick={() => onReview()}
          disabled={reviewing}
          className="gap-2"
        >
          {reviewing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UserCheck className="size-4" />
          )}
          {reviewing ? "审查中..." : "开始审查"}
        </Button>
      </div>

      {/* Person List */}
      <div className="flex-1 overflow-auto rounded-lg border">
        <table className="w-full">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b text-xs uppercase text-muted-foreground">
              <th className="px-4 py-3 text-left">姓名</th>
              <th className="px-4 py-3 text-left">身份证</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-right">疑点数</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {persons.map((person) => (
              <tr key={person.personId} className="border-b hover:bg-muted/50">
                <td className="px-4 py-3">{person.personName}</td>
                <td className="px-4 py-3 font-mono text-xs">{person.personId}</td>
                <td className="px-4 py-3">
                  <Badge variant={
                    person.status === "done" ? "default" :
                    person.status === "error" ? "destructive" :
                    "secondary"
                  }>
                    {person.status === "done" ? "已完成" :
                     person.status === "error" ? "失败" : "待审查"}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {person.issuesCount > 0 ? (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="size-3" />
                      {person.issuesCount}
                    </Badge>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {person.status === "pending" && (
                    <Button
                      variant="ghost"
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
function Step4Result({ persons, ledger, onGenerateLedger, filterStatus, onFilterStatus, searchTerm, onSearchTerm, filteredLedger, stats }: {
  persons: PersonInfo[];
  ledger: LedgerRow[];
  onGenerateLedger: () => void;
  filterStatus: string | null;
  onFilterStatus: (status: string | null) => void;
  searchTerm: string;
  onSearchTerm: (term: string) => void;
  filteredLedger: LedgerRow[];
  stats: { total: number; ok: number; issues: number };
}) {
  const statusFilters = ["齐全", "缺件", "待核实", "超限", "部分审查"];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">总人数</p>
          <p className="text-2xl font-semibold">{stats.total}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">齐全</p>
          <p className="text-2xl font-semibold text-green-600">{stats.ok}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">有疑点</p>
          <p className="text-2xl font-semibold text-amber-600">{stats.issues}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button 
          onClick={onGenerateLedger}
          variant="outline"
          className="gap-2"
        >
          <BarChart3 className="size-4" />
          生成台账
        </Button>

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索姓名或身份证号..."
            value={searchTerm}
            onChange={(e) => onSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>

        <select
          value={filterStatus || ""}
          onChange={(e) => onFilterStatus(e.target.value || null)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="">全部状态</option>
          {statusFilters.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Ledger Table */}
      <div className="flex-1 overflow-auto rounded-lg border">
        {filteredLedger.length > 0 ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 text-left">姓名</th>
                <th className="px-4 py-3 text-left">身份证</th>
                <th className="px-4 py-3 text-left">状态</th>
                <th className="px-4 py-3 text-left">缺件</th>
                <th className="px-4 py-3 text-left">疑点</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredLedger.map((row, idx) => (
                <tr key={idx} className="border-b hover:bg-muted/50">
                  <td className="px-4 py-3">{row.person_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.person_id}</td>
                  <td className="px-4 py-3">
                    <Badge variant={
                      row.status === "齐全" ? "default" :
                      row.status === "缺件" ? "destructive" :
                      "secondary"
                    }>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">{row.missing_items || "-"}</td>
                  <td className="px-4 py-3 text-sm">{row.issue_items || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm">
                      <FileText className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            暂无数据，请先生成台账
          </div>
        )}
      </div>
    </div>
  );
}