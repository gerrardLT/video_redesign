'use client'

import { useEffect, useState } from 'react'

interface ProjectItem {
  id: string
  name: string
  status: string
  shotCount: number
  userEmail: string
  userNickname: string | null
  createdAt: string
}

function statusColor(status: string) {
  switch (status) {
    case 'COMPLETED': return 'bg-green-500/20 text-[var(--cine-green)]'
    case 'PROCESSING': return 'bg-blue-500/20 text-blue-400'
    case 'FAILED': return 'bg-red-500/20 text-red-400'
    case 'DRAFT': return 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
    default: return 'bg-[var(--cine-surface)] text-[var(--cine-text-2)]'
  }
}

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/admin/projects')
      .then((res) => {
        if (!res.ok) throw new Error('获取项目列表失败')
        return res.json()
      })
      .then((data) => setProjects(data.projects))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '未知错误'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">项目管理</h1>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--cine-gold)] border-t-transparent" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--cine-line-2)] bg-[var(--cine-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cine-line-2)] text-left text-[var(--cine-text-2)]">
                <th className="px-4 py-3 font-medium">项目名</th>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">分镜数</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {projects.map((project) => (
                <tr key={project.id} className="text-[var(--cine-text)] hover:bg-[var(--cine-surface)]">
                  <td className="px-4 py-3 font-medium">{project.name}</td>
                  <td className="px-4 py-3 text-xs">{project.userEmail}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${statusColor(project.status)}`}>
                      {project.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{project.shotCount}</td>
                  <td className="px-4 py-3 text-[var(--cine-text-2)]">
                    {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[var(--cine-text-3)]">
                    暂无项目数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
