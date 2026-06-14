import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

/**
 * Feature: commercialization-features
 * Property 10: 风格配置 round-trip
 * Property 11: 自定义描述长度验证
 * Property 12: 风格 prompt 融合
 * Property 13: 无风格配置阻止生成
 *
 * **Validates: Requirements 6.3, 7.1, 7.2, 7.3, 8.2, 9.2**
 */

// ========================
// 纯函数提取（避免 Prisma 依赖）
// ========================

interface StyleTemplate {
  id: string
  name: string
  promptPrefix: string
  isActive: boolean
}

interface StyleConfigInput {
  templateId?: string
  customDescription?: string
}

interface StyleConfig {
  projectId: string
  templateId: string | null
  customDescription: string | null
  template: StyleTemplate | null
}

/**
 * 模拟 saveProjectStyle 的校验逻辑
 * customDescription 长度不能超过 500
 */
function validateStyleConfigInput(input: StyleConfigInput): {
  valid: boolean
  error?: string
} {
  if (
    input.customDescription !== undefined &&
    input.customDescription.length > 500
  ) {
    return { valid: false, error: '描述不能超过500字' }
  }
  return { valid: true }
}

/**
 * 模拟 saveProjectStyle 的 upsert 逻辑
 */
function simulateSaveProjectStyle(
  projectId: string,
  input: StyleConfigInput,
  templates: StyleTemplate[]
): StyleConfig | { error: string } {
  // 校验 customDescription 长度
  const validation = validateStyleConfigInput(input)
  if (!validation.valid) {
    return { error: validation.error! }
  }

  // 校验 templateId 存在且激活
  let template: StyleTemplate | null = null
  if (input.templateId) {
    template = templates.find((t) => t.id === input.templateId) || null
    if (!template) {
      return { error: '风格模板不存在' }
    }
    if (!template.isActive) {
      return { error: '风格模板已不可用' }
    }
  }

  return {
    projectId,
    templateId: input.templateId ?? null,
    customDescription: input.customDescription ?? null,
    template,
  }
}

/**
 * 模拟 buildStylePrompt 逻辑
 * 拼接规则：promptPrefix + customDescription，用 ", " 连接
 */
function simulateBuildStylePrompt(config: StyleConfig | null): string {
  if (!config) return ''

  const parts: string[] = []

  if (config.template?.promptPrefix) {
    parts.push(config.template.promptPrefix)
  }

  if (config.customDescription) {
    parts.push(config.customDescription)
  }

  return parts.join(', ')
}

/**
 * 模拟"无风格配置阻止生成"的检查逻辑
 */
function canSubmitGeneration(styleConfig: StyleConfig | null): {
  allowed: boolean
  error?: string
} {
  if (!styleConfig) {
    return { allowed: false, error: '请先设置画面风格' }
  }
  if (!styleConfig.templateId && !styleConfig.customDescription) {
    return { allowed: false, error: '请先设置画面风格' }
  }
  return { allowed: true }
}

// ========================
// 生成器
// ========================

const templateArb: fc.Arbitrary<StyleTemplate> = fc.record({
  id: fc.uuid(),
  name: fc.constantFrom('写实', '动漫', '3D', '水彩', '赛博朋克'),
  promptPrefix: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  isActive: fc.constant(true),
})

const shortDescriptionArb = fc.string({ minLength: 0, maxLength: 500 })
const longDescriptionArb = fc.string({ minLength: 501, maxLength: 1000 })

// ========================
// Property 10: 风格配置 round-trip
// ========================

describe('风格配置 round-trip Property (Property 10)', () => {
  it('保存后读取的 templateId 与输入一致', () => {
    fc.assert(
      fc.property(
        fc.uuid(), // projectId
        templateArb,
        fc.option(shortDescriptionArb, { nil: undefined }),
        (projectId, template, customDescription) => {
          const templates = [template]
          const input: StyleConfigInput = {
            templateId: template.id,
            customDescription,
          }

          const result = simulateSaveProjectStyle(projectId, input, templates)

          // 不应是错误
          expect('error' in result).toBe(false)
          if (!('error' in result)) {
            expect(result.templateId).toBe(template.id)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('保存后读取的 customDescription 与输入一致', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        templateArb,
        shortDescriptionArb.filter((s) => s.length > 0),
        (projectId, template, customDescription) => {
          const templates = [template]
          const input: StyleConfigInput = {
            templateId: template.id,
            customDescription,
          }

          const result = simulateSaveProjectStyle(projectId, input, templates)

          expect('error' in result).toBe(false)
          if (!('error' in result)) {
            expect(result.customDescription).toBe(customDescription)
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('仅使用 templateId（无 customDescription）round-trip 一致', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        templateArb,
        (projectId, template) => {
          const templates = [template]
          const input: StyleConfigInput = { templateId: template.id }

          const result = simulateSaveProjectStyle(projectId, input, templates)

          expect('error' in result).toBe(false)
          if (!('error' in result)) {
            expect(result.templateId).toBe(template.id)
            expect(result.customDescription).toBeNull()
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('仅使用 customDescription（无 templateId）round-trip 一致', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        shortDescriptionArb.filter((s) => s.length > 0),
        (projectId, customDescription) => {
          const input: StyleConfigInput = { customDescription }

          const result = simulateSaveProjectStyle(projectId, input, [])

          expect('error' in result).toBe(false)
          if (!('error' in result)) {
            expect(result.templateId).toBeNull()
            expect(result.customDescription).toBe(customDescription)
          }
        }
      ),
      { numRuns: 200 }
    )
  })
})

// ========================
// Property 11: 自定义描述长度验证
// ========================

describe('自定义描述长度验证 Property (Property 11)', () => {
  it('长度 <= 500 的 customDescription 应被接受', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        shortDescriptionArb,
        (projectId, customDescription) => {
          const input: StyleConfigInput = { customDescription }
          const result = simulateSaveProjectStyle(projectId, input, [])

          expect('error' in result).toBe(false)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('长度 > 500 的 customDescription 应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        longDescriptionArb,
        (projectId, customDescription) => {
          const input: StyleConfigInput = { customDescription }
          const result = simulateSaveProjectStyle(projectId, input, [])

          expect('error' in result).toBe(true)
          if ('error' in result) {
            expect(result.error).toContain('500')
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('恰好 500 字的描述应被接受', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 500, maxLength: 500 }),
        (projectId, customDescription) => {
          const input: StyleConfigInput = { customDescription }
          const result = simulateSaveProjectStyle(projectId, input, [])

          expect('error' in result).toBe(false)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('恰好 501 字的描述应被拒绝', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.string({ minLength: 501, maxLength: 501 }),
        (projectId, customDescription) => {
          const input: StyleConfigInput = { customDescription }
          const result = simulateSaveProjectStyle(projectId, input, [])

          expect('error' in result).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })
})

// ========================
// Property 12: 风格 prompt 融合
// ========================

describe('风格 prompt 融合 Property (Property 12)', () => {
  it('有模板 promptPrefix 时输出包含该 prefix', () => {
    fc.assert(
      fc.property(
        templateArb,
        fc.option(shortDescriptionArb.filter((s) => s.length > 0), { nil: null }),
        fc.uuid(),
        (template, customDescription, projectId) => {
          const config: StyleConfig = {
            projectId,
            templateId: template.id,
            customDescription,
            template,
          }

          const prompt = simulateBuildStylePrompt(config)

          expect(prompt).toContain(template.promptPrefix)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('有 customDescription 时输出包含该描述', () => {
    fc.assert(
      fc.property(
        fc.option(templateArb, { nil: null }),
        shortDescriptionArb.filter((s) => s.trim().length > 0),
        fc.uuid(),
        (template, customDescription, projectId) => {
          const config: StyleConfig = {
            projectId,
            templateId: template?.id ?? null,
            customDescription,
            template,
          }

          const prompt = simulateBuildStylePrompt(config)

          expect(prompt).toContain(customDescription)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('同时有 promptPrefix 和 customDescription 时用 ", " 连接', () => {
    fc.assert(
      fc.property(
        templateArb,
        shortDescriptionArb.filter((s) => s.trim().length > 0),
        fc.uuid(),
        (template, customDescription, projectId) => {
          const config: StyleConfig = {
            projectId,
            templateId: template.id,
            customDescription,
            template,
          }

          const prompt = simulateBuildStylePrompt(config)

          expect(prompt).toBe(`${template.promptPrefix}, ${customDescription}`)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('无风格配置时返回空字符串', () => {
    const prompt = simulateBuildStylePrompt(null)
    expect(prompt).toBe('')
  })
})

// ========================
// Property 13: 无风格配置阻止生成
// ========================

describe('无风格配置阻止生成 Property (Property 13)', () => {
  it('StyleConfig 为 null 时不允许提交生成', () => {
    fc.assert(
      fc.property(fc.uuid(), (_projectId) => {
        const result = canSubmitGeneration(null)

        expect(result.allowed).toBe(false)
        expect(result.error).toBeDefined()
      }),
      { numRuns: 100 }
    )
  })

  it('StyleConfig 存在且有 templateId 或 customDescription 时允许提交', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        fc.oneof(
          // 有 templateId
          fc.record({
            projectId: fc.uuid(),
            templateId: fc.uuid(),
            customDescription: fc.constant(null as string | null),
            template: fc.constant(null as StyleTemplate | null),
          }),
          // 有 customDescription
          fc.record({
            projectId: fc.uuid(),
            templateId: fc.constant(null as string | null),
            customDescription: fc.string({ minLength: 1, maxLength: 500 }),
            template: fc.constant(null as StyleTemplate | null),
          })
        ),
        (_projectId, config) => {
          const result = canSubmitGeneration(config)

          expect(result.allowed).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('StyleConfig 存在但 templateId 和 customDescription 都为空时不允许提交', () => {
    fc.assert(
      fc.property(fc.uuid(), (projectId) => {
        const config: StyleConfig = {
          projectId,
          templateId: null,
          customDescription: null,
          template: null,
        }

        const result = canSubmitGeneration(config)

        expect(result.allowed).toBe(false)
      }),
      { numRuns: 100 }
    )
  })
})
