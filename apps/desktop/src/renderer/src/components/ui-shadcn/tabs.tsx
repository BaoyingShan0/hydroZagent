import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "../../lib/utils"

/**
 * shadcn Tabs 组件（基于 radix-ui 聚合包）。
 * 默认样式：TabsList 为无底色下划线容器，TabsTrigger 为下划线式 tab——
 * 与项目既有 prompts-tab-btn 视觉对齐，避免换组件造成视觉回归。
 */
function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-auto w-full items-center gap-0.5 rounded-md border border-border-subtle bg-bg-muted p-1 text-text-tertiary",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm border border-transparent bg-transparent px-4 py-1.5 text-[13px] whitespace-nowrap !text-[color:var(--color-text-secondary)] shadow-none transition-colors hover:!text-[color:var(--color-text-primary)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-border-subtle data-[state=active]:bg-bg-panel data-[state=active]:!text-[color:var(--color-text-primary)] data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-hidden", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
