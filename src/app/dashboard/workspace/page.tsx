/**
 * 工作台页面（Server Component 壳）
 *
 * 工作台是快速单次视频生成的核心入口，与「分镜工厂」互补。
 * 实际交互逻辑在 WorkspaceClient 客户端组件中实现。
 */

import { WorkspaceClient } from '@/components/workspace/WorkspaceClient'

export default function WorkspacePage() {
  return <WorkspaceClient />
}
