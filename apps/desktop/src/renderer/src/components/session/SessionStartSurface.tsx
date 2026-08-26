import { useRef, type ReactNode } from "react";
import { useSessionPaneServices } from "./SessionPaneServices";
import { ComposerArea } from "./ComposerArea";
import { QueuedPromptPanel } from "./ComposerPanels";
import { SessionGoalStrip } from "./SessionGoalStrip";
import { SessionTodoStrip } from "./SessionTodoStrip";
import { HydroWelcomeBackdrop, HydroWelcomeHeader } from "./HydroWelcomeHeader";

/**
 * 新会话起始页（DeepSeek 式居中输入框）：匿名/新会话还没有消息时，
 * 页面中央直接挂完整的 ComposerArea——模型/思考级别/模式/发送/附件/
 * 安全级别等一切能力都是现成的（services 经 context 注入，零透传），
 * 不再为起始页维护第二套输入框实现。
 *
 * 底部 composer 面板在无消息时不渲染（SessionView 按 messages.length 判断），
 * 避免同屏出现两个输入框；发送后消息出现，居中页自动退出。
 */

export function SessionStartSurface(props: {
  sessionId: string;
  /** 可选项目切换器：引导页（无会话空态）传入，标明并可切换下一次发送将会话创建到哪个项目 */
  projectSwitcher?: ReactNode;
}) {
  const services = useSessionPaneServices();
  const queuedTrackRef = useRef<HTMLElement | null>(null);
  const activeQueuedPrompts = services.queuedPromptsBySession[props.sessionId] ?? [];

  return (
    // session-start-surface 保留类名供壁纸模式契约（bg-transparent 透出下层壁纸）；
    // pt-[18vh] 把重心压向视口中心（输入框顶约 36-40%、框心 ~55%），接近 DeepSeek
    // 新会话页沿用品牌正文 14/22，不另造第五档字号。
    <div className="session-start-surface relative flex min-h-full w-full flex-col items-center gap-5 overflow-hidden bg-transparent px-6 pb-10 pt-[9vh] [--font-size-input:14px] [--line-height-input:22px]">
      <HydroWelcomeBackdrop />
      <HydroWelcomeHeader />
      <div className="relative z-10">{props.projectSwitcher}</div>
      {/* 复用会话页底部输入框组件：defaultHeight 起步高度 150px（先 300 太大改 100 又太小，
          取中间值），底部栏（模型/思考/模式/安全级别/git）与发送按钮全保留 */}
      <div className="relative z-10 w-full max-w-[920px]">
        <ComposerArea
          sessionId={props.sessionId}
          defaultHeight={150}
          gitInfo={services.gitInfo}
          enqueue={services.enqueueSessionPrompt}
          ensureSessionId={services.ensureSessionId}
          widgets={
            <>
              <SessionTodoStrip sessionId={props.sessionId} />
              <SessionGoalStrip sessionId={props.sessionId} />
            </>
          }
          queuePanel={
            <QueuedPromptPanel
              trackRef={queuedTrackRef}
              sessionId={props.sessionId}
              prompts={activeQueuedPrompts}
              visiblePrompts={activeQueuedPrompts}
              onRetract={services.queueRetract}
              onDiscard={services.queueDiscard}
              onChangeBehavior={services.queueChangeBehavior}
            />
          }
        />
      </div>
    </div>
  );
}
