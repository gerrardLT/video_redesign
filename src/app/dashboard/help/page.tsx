'use client'

import { useState } from 'react'

/**
 * 帮助中心页面
 * 提供完整的使用教程（可展开/折叠的步骤指南）+ 常见问题解答
 * 所有内容基于平台真实功能：视频上传→AI解析→分镜编辑→角色锚定→链式生成→合并导出
 */

interface TutorialSection {
  id: number
  title: string
  content: string
  tips: string[]
}

const tutorialSections: TutorialSection[] = [
  {
    id: 1,
    title: '创建项目',
    content: '进入"我的项目"页面，点击"新建项目"按钮创建项目。输入项目名称后即完成创建，进入项目详情页准备上传视频。',
    tips: [
      '项目名称建议使用有辨识度的描述，方便后续管理多个项目',
      '每个项目对应一段原始视频，生成的所有分镜和导出文件都归属于该项目',
    ],
  },
  {
    id: 2,
    title: '上传视频 / 链接导入',
    content: '支持两种方式导入原始视频：直接上传本地视频文件（支持 MP4/MOV/AVI，最大 500MB，时长不超过 2 分钟），或通过链接导入（支持抖音、快手、B站公开视频链接）。粘贴链接后系统自动下载，无需手动操作。',
    tips: [
      '推荐上传 720p 以上分辨率的原始视频以获得最佳解析效果',
      '链接导入时请确保视频为公开状态，私密视频无法下载',
      '上传后系统会自动进行视频标准化（统一编码和帧率），耗时约 10-30 秒',
    ],
  },
  {
    id: 3,
    title: 'AI 智能解析',
    content: '视频上传完成后，点击"开始解析"触发 AI 分镜解析。系统使用多模态 AI 模型分析视频内容，自动拆分镜头、识别场景切换点、生成每个分镜的描述词和时间轴信息。解析同时会切片音频，为后续音画同步做准备。',
    tips: [
      '解析时长取决于视频长度，通常 30-90 秒完成',
      '解析消耗积分（按视频时长计算），解析前系统会预检余额是否充足',
      'AI 生成的分镜描述词仅作为初始参考，建议手动调优以获得更好生成效果',
    ],
  },
  {
    id: 4,
    title: '编辑分镜',
    content: '解析完成后进入分镜编辑器。左侧为分镜列表，展示每个分镜的封面帧、时长和状态。每个分镜包含提示词（prompt）、时长和参考角色三个核心要素，均可独立编辑。系统会将相邻镜头自动分组为"分镜组"——这是 AI 生成的最小单位。',
    tips: [
      '提示词建议 50-150 字，具体描述场景环境、人物动作、镜头运动',
      '分镜组内的镜头会在一次 AI 调用中连续生成，确保组内画面连贯',
      '时间轴由系统自动校验（非负、不重叠、不超总时长），放心调整',
    ],
  },
  {
    id: 5,
    title: '设置角色参考图（人物一致性）',
    content: '为保持同一角色在所有分镜中外观一致，进入角色管理面板上传参考图。支持上传真实照片或通过 AI 生成角色形象图。设置后，所有分镜生成时都会携带该参考图，确保人物面容、服装、体态跨镜头保持一致。',
    tips: [
      '参考图建议使用正面、光线充足、背景简洁的照片，效果最佳',
      '生成的角色图会保存到资产库，可跨项目复用',
      '角色图会自动关联到分镜中，无需重复上传',
    ],
  },
  {
    id: 6,
    title: '生成视频',
    content: '编辑完分镜后，点击"开始生成"启动 AI 视频生成。系统采用链式串行模式：按分镜组顺序逐一生成，前一组的最后一帧作为下一组的起始参考（同场景尾帧衔接），保证镜头间自然过渡。生成过程中可实时查看进度。',
    tips: [
      '链式串行确保镜头连贯，生成顺序不可跳跃',
      '每个分镜组生成约 60 秒，总时长取决于分镜组数量',
      '生成失败的分镜组积分会自动退还，不会静默扣费',
    ],
  },
  {
    id: 7,
    title: '合并导出',
    content: '所有分镜组生成完毕后，点击"导出"进行视频合并。支持三种分辨率：480p（快速预览）、720p（高清）、1080p（超清）。合并时会应用转场效果并同步原始音频，导出为 MP4 文件可直接下载。',
    tips: [
      '三种分辨率均免费导出，无额外费用',
      '建议先用 480p 快速预览整体效果，确认满意后再导出高清版本',
      '导出的文件保留 14 天，请及时下载保存',
    ],
  },
  {
    id: 8,
    title: '版本管理',
    content: '每次生成都会自动保存为新版本。在分镜面板中可查看版本历史，支持 A/B 对比切换不同版本的生成结果。不满意可调整提示词后重新生成，历史版本随时可切回。',
    tips: [
      '点击版本缩略图可快速预览，双击切换为当前使用版本',
      '重新生成前建议先微调提示词或更换参考图，而非使用完全相同的配置',
      '合并导出时使用各分镜当前选中的版本',
    ],
  },
  {
    id: 9,
    title: '资产库管理',
    content: '所有生成的角色图、视频片段、合并导出的文件都会统一存储在资产库中。角色图支持跨项目复用——在新项目中可直接从资产库选取已有角色，无需重新上传或生成。资产默认保留 14 天，到期前会收到提醒通知。',
    tips: [
      '常用角色图建议及时下载本地备份，避免过期丢失',
      '资产库中的角色图可一键应用到任何新项目的分镜中',
      '过期清理每日凌晨 3 点执行，到期当天仍可正常使用',
    ],
  },
]

const faqItems = [
  {
    q: '支持的视频时长是多少？',
    a: '目前支持最长 2 分钟的视频。如果原始视频超过 2 分钟，建议先裁剪为多段分别处理。系统会在上传时检查时长，超时视频无法进入解析流程。',
  },
  {
    q: '生成一个视频需要多长时间？',
    a: '从 AI 解析到全部分镜生成完成，通常需要 3-5 分钟（取决于分镜数量）。AI 解析约 30-90 秒，每个分镜组生成约 60 秒，合并导出约 30 秒。链式串行模式下总时长 = 分镜组数 × 单组耗时。',
  },
  {
    q: '生成失败会扣积分吗？',
    a: '不会。生成采用"预扣-确认"机制：启动时预冻结积分，成功后正式扣除，失败则自动退还冻结的积分。整个过程无需人工干预，积分变动可在"积分记录"中查看明细。',
  },
  {
    q: '支持哪些输出分辨率？',
    a: '支持 480p（快速预览）、720p（高清）、1080p（超清）三档，均免费导出，无额外费用。高清/超清处理需额外等待约 30 秒。',
  },
  {
    q: '人物一致性是怎么实现的？',
    a: '通过"角色锚定图"方案：上传或生成角色参考图后，系统在每个分镜组的生成请求中都携带该参考图，AI 模型据此保持人物面容、服装、体态的跨镜头一致性。',
  },
  {
    q: '积分系统如何运作？',
    a: '注册即送初始积分用于体验。积分消耗发生在视频解析和 AI 生成环节。解析前系统会预检余额，余额不足直接拒绝（不允许透支）。可通过购买积分包或开通会员获得积分。积分永不过期。',
  },
  {
    q: '支持哪些平台的链接导入？',
    a: '目前支持抖音、快手、B站的公开视频链接导入。导入时请确保视频为公开状态，私密/好友可见的视频无法下载。粘贴链接后系统自动处理，无需安装额外软件。',
  },
  {
    q: '角色图可以跨项目使用吗？',
    a: '可以。生成或上传的角色图会保存到资产库，在创建新项目时可直接从资产库选取已有角色图应用到分镜中，无需重新上传或生成，实现同一人物多项目复用。',
  },
  {
    q: '链式生成是什么意思？',
    a: '链式串行生成是指按分镜组顺序逐一生成视频：前一个分镜组生成完成后，提取其最后一帧作为下一个分镜组的起始参考帧。这种"尾帧衔接"技术确保相邻镜头画面自然过渡，不会出现突兀的跳切。',
  },
  {
    q: '导出的视频文件保留多久？',
    a: '生成的视频和合并导出的文件在资产库中保留 14 天。到期前系统会发送通知提醒，到期后 OSS 文件会被自动清理。建议在保留期内及时下载保存重要文件。',
  },
]

export default function HelpPage() {
  const [expandedSections, setExpandedSections] = useState<number[]>([1])

  const toggleSection = (id: number) => {
    setExpandedSections(prev =>
      prev.includes(id)
        ? prev.filter(s => s !== id)
        : [...prev, id]
    )
  }

  const expandAll = () => setExpandedSections(tutorialSections.map(s => s.id))
  const collapseAll = () => setExpandedSections([])

  return (
    <div>
      {/* 页面标题 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">帮助中心</h1>
        <p className="mt-2 text-sm text-[var(--cine-text-2)]">
          完整的使用教程与常见问题解答，帮助你快速上手平台
        </p>
      </div>

      {/* 使用教程 */}
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">📖 使用教程</h2>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="rounded-md border border-[var(--cine-line-2)] px-3 py-1 text-xs text-[var(--cine-text-2)] transition hover:border-[var(--cine-gold)] hover:text-[var(--cine-gold)]"
            >
              全部展开
            </button>
            <button
              onClick={collapseAll}
              className="rounded-md border border-[var(--cine-line-2)] px-3 py-1 text-xs text-[var(--cine-text-2)] transition hover:border-[var(--cine-gold)] hover:text-[var(--cine-gold)]"
            >
              全部折叠
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {tutorialSections.map(section => {
            const isExpanded = expandedSections.includes(section.id)
            return (
              <div
                key={section.id}
                id={`section-${section.id}`}
                className="overflow-hidden rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)] transition-colors hover:border-[var(--cine-line-2)]"
              >
                {/* 步骤标题（可点击展开/折叠） */}
                <button
                  onClick={() => toggleSection(section.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition"
                >
                  {/* 步骤编号 */}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--cine-gold-dim)] text-xs font-bold text-[var(--cine-gold)]">
                    {section.id}
                  </span>
                  <span className="flex-1 text-sm font-medium text-[var(--cine-text)]">
                    {section.title}
                  </span>
                  {/* 展开/折叠图标 */}
                  <svg
                    className={`h-4 w-4 shrink-0 text-[var(--cine-text-3)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* 展开内容 */}
                {isExpanded && (
                  <div className="border-t border-[var(--cine-line)] px-5 py-4">
                    {/* 正文说明 */}
                    <p className="text-sm leading-relaxed text-[var(--cine-text-2)]">
                      {section.content}
                    </p>

                    {/* 提示框（金色边框高亮） */}
                    <div className="mt-4 rounded-lg border-l-[3px] border-[var(--cine-gold)] bg-[var(--cine-gold-dim)] px-4 py-3">
                      <p className="mb-1.5 text-xs font-semibold text-[var(--cine-gold)]">💡 小贴士</p>
                      <ul className="space-y-1">
                        {section.tips.map((tip, idx) => (
                          <li key={idx} className="text-xs leading-relaxed text-[var(--cine-text-2)]">
                            • {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* FAQ 常见问题 */}
      <section className="mb-8">
        <h2 className="mb-4 text-lg font-semibold text-white">❓ 常见问题</h2>
        <div className="space-y-3">
          {faqItems.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-[var(--cine-line)] bg-[var(--cine-surface)] p-5"
            >
              <h3 className="text-sm font-medium text-[var(--cine-text)]">{item.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--cine-text-2)]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 联系客服 */}
      <div className="rounded-xl border border-[var(--cine-line-2)] bg-[var(--cine-surface)] p-6 text-center">
        <p className="text-sm text-[var(--cine-text-2)]">没有找到答案？</p>
        <p className="mt-1 text-xs text-[var(--cine-text-3)]">
          联系客服：support@videoredesign.com
        </p>
      </div>
    </div>
  )
}
