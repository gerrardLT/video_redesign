'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'

export default function LandingPage() {
  const heroTitleRef = useRef<HTMLHeadingElement>(null)
  const videoOriginalRef = useRef<HTMLVideoElement>(null)
  const videoRedesignRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    // Hero title per-character animation with organic timing
    const titleText = '一段视频\n两个世界'
    const titleEl = heroTitleRef.current
    if (!titleEl) return

    const chars = titleText.split('').filter(c => c !== '\n')
    const totalChars = chars.length
    let charIdx = 0

    titleText.split('').forEach((char) => {
      if (char === '\n') {
        titleEl.appendChild(document.createElement('br'))
        return
      }
      const span = document.createElement('span')
      span.className = 'lp-char'
      const goldStart = titleText.replace('\n', '').indexOf('世界')
      const isGold = charIdx >= goldStart && charIdx < goldStart + 2
      if (isGold) {
        const em = document.createElement('em')
        em.className = 'lp-gold-pulse'
        em.textContent = char
        span.appendChild(em)
      } else {
        span.textContent = char
      }
      const progress = charIdx / totalChars
      const eased = Math.sin(progress * Math.PI) * 0.5 + 0.5
      const delay = 0.5 + charIdx * 0.07 + (1 - eased) * 0.12
      span.style.animationDelay = `${delay.toFixed(3)}s`
      titleEl.appendChild(span)
      charIdx++
    })

    // Scroll reveal
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('lp-visible')
          // Counter animation
          const counter = e.target.querySelector('[data-count]') as HTMLElement | null
          if (counter && !counter.dataset.animated) {
            counter.dataset.animated = 'true'
            const target = parseInt(counter.dataset.count || '0')
            const duration = 1200
            const start = performance.now()
            function tick(now: number) {
              const progress = Math.min((now - start) / duration, 1)
              const eased = 1 - Math.pow(1 - progress, 3)
              counter!.textContent = String(Math.round(target * eased))
              if (progress < 1) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' })

    document.querySelectorAll('[data-lp-reveal]').forEach(el => obs.observe(el))

    // Parallax
    let ticking = false
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(() => {
          const y = window.scrollY
          const bgFar = document.querySelector('.lp-bg-far') as HTMLElement | null
          if (bgFar) bgFar.style.transform = `scale(1.05) translateY(${y * 0.25}px)`
          const fgOrbs = document.querySelector('.lp-fg-orbs') as HTMLElement | null
          if (fgOrbs) fgOrbs.style.transform = `translateY(${y * -0.2}px)`
          ticking = false
        })
        ticking = true
      }
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 两段视频同步播放：仅在循环时重新对齐，不干扰浏览器原生 autoPlay
  useEffect(() => {
    const vOrig = videoOriginalRef.current
    const vRedo = videoRedesignRef.current
    if (!vOrig || !vRedo) return

    // 当较短的视频 loop 回到起点时，同步较长的那个也回起点
    const handleTimeUpdate = () => {
      // 如果其中一个回到了开头附近（loop 触发），把另一个也拉回起点
      if (vOrig.currentTime < 0.1 && vRedo.currentTime > 0.5) {
        vRedo.currentTime = 0
      }
    }

    const handleTimeUpdateRedo = () => {
      if (vRedo.currentTime < 0.1 && vOrig.currentTime > 0.5) {
        vOrig.currentTime = 0
      }
    }

    vOrig.addEventListener('seeked', handleTimeUpdate)
    vRedo.addEventListener('seeked', handleTimeUpdateRedo)

    return () => {
      vOrig.removeEventListener('seeked', handleTimeUpdate)
      vRedo.removeEventListener('seeked', handleTimeUpdateRedo)
    }
  }, [])

  return (
    <div className="lp-root">
      {/* Nav */}
      <nav className="lp-nav">
        <div className="lp-nav-logo">
          <div className="lp-nav-mark">幕</div>
          <span className="lp-nav-nm">视频重塑</span>
        </div>
        <div className="lp-nav-links">
          <a href="#features">功能</a>
          <a href="#showcase">案例</a>
          <a href="/help">帮助</a>
          <Link href="/dashboard" className="lp-nav-cta">开始使用</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-bg-far" />
        <div className="lp-light-source" />
        <div className="lp-fg-orbs"><div className="lp-orb" /><div className="lp-orb" /><div className="lp-orb" /></div>

        <div className="lp-hero-left">
          <div className="lp-kicker">
            <span className="lp-line-reveal"><span className="lp-line-inner">Before → After</span></span>
          </div>
          <h1 className="lp-hero-title" ref={heroTitleRef} />
          <p className="lp-hero-sub">
            <span className="lp-line-reveal"><span className="lp-line-inner" style={{ animationDelay: '1.2s' }}>上传你的原始视频，AI 保持人物一致、分镜级精细控制——几分钟后，拿到完全重塑的新版本。</span></span>
          </p>
          <div className="lp-hero-ctas">
            <Link href="/dashboard/showcase" className="lp-btn-primary">查看真实案例</Link>
            <a href="#contact" className="lp-btn-ghost">联系我们</a>
          </div>
        </div>

        <div className="lp-hero-right">
          <div className="lp-video-compare">
            <div className="lp-vc-item">
              <video
                ref={videoOriginalRef}
                className="lp-vc-video"
                src="https://video-redesign-sh.oss-cn-shanghai.aliyuncs.com/34af8c2ba42b86d5a4f9f66fe9371f19.mp4"
                autoPlay
                loop
                muted
                playsInline
              />
              <span className="lp-vc-label">原视频</span>
            </div>
            <div className="lp-vc-divider"><div className="lp-vc-divider-line" /><div className="lp-vc-divider-badge">VS</div></div>
            <div className="lp-vc-item lp-vc-after">
              <video
                ref={videoRedesignRef}
                className="lp-vc-video"
                src="https://video-redesign-sh.oss-cn-shanghai.aliyuncs.com/exported/cmqg0pi140000z05iali2xz9z/cmql4fkqe000c485i19jwrfkr/upscaled_1781949930605.mp4"
                autoPlay
                loop
                muted
                playsInline
              />
              <span className="lp-vc-label">AI 重塑</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="lp-stats">
        <div className="lp-stats-light" />
        <div className="lp-stat" data-lp-reveal><div className="lp-stat-n" data-count="3">0</div><div className="lp-stat-l">分钟平均出片</div></div>
        <div className="lp-stat" data-lp-reveal><div className="lp-stat-n" data-count="98">0</div><div className="lp-stat-l">人物一致性 %</div></div>
        <div className="lp-stat" data-lp-reveal><div className="lp-stat-n" data-count="7">0</div><div className="lp-stat-l">步全流程可控</div></div>
      </section>

      {/* Features — 6 张功能卡片，3列2行 */}
      <section className="lp-features" id="features">
        <div className="lp-features-glow" />
        <h2 data-lp-reveal>为什么选择视频重塑</h2>
        <div className="lp-feat-grid">
          <div className="lp-feat-card" data-lp-reveal><div className="lp-feat-num">01</div><h3>人物一致性</h3><p>上传角色参考图，AI 在所有分镜中保持同一人物的面容、服装一致。告别&ldquo;每帧换脸&rdquo;。</p></div>
          <div className="lp-feat-card" data-lp-reveal><div className="lp-feat-num">02</div><h3>分镜级控制</h3><p>每个镜头独立编辑提示词、时长、参考角色——导演级精细掌控每一帧。</p></div>
          <div className="lp-feat-card" data-lp-reveal><div className="lp-feat-num">03</div><h3>链式连贯生成</h3><p>同场景尾帧衔接技术，前一组最后一帧作为下一组起始参考，镜头间自然过渡。</p></div>
          <div className="lp-feat-card" data-lp-reveal><div className="lp-feat-num">04</div><h3>智能视频解析</h3><p>AI 多模态分析，自动拆分镜头、识别场景切换、生成分镜描述词。</p></div>
          <div className="lp-feat-card" data-lp-reveal><div className="lp-feat-num">05</div><h3>多分辨率导出</h3><p>480p 快速预览，720p/1080p 超分输出。一次生成，多档交付。</p></div>
          <div className="lp-feat-card" data-lp-reveal><div className="lp-feat-num">06</div><h3>资产复用</h3><p>角色图跨项目应用，资产库统一管理，同一人物多项目复用无需重新生成。</p></div>
        </div>
      </section>

      {/* How it works — 嵌入动画 */}
      <section className="lp-how">
        <div className="lp-how-kicker" data-lp-reveal>工作流程</div>
        <h2 data-lp-reveal>四步，从原片到新片</h2>
        <div className="lp-how-anim" data-lp-reveal>
          <iframe src="/workflow-animation.html" title="工作流程动画" />
        </div>
      </section>

      {/* 人物一致性深度 — 真实视频对比 */}
      <section className="lp-deep">
        <div className="lp-deep-light" />
        <div className="lp-deep-inner" data-lp-reveal>
          <div className="lp-deep-visual">
            <div className="lp-deep-videos">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://video-redesign-sh.oss-cn-shanghai.aliyuncs.com/cover/cmqllhs62000h485ifn8riuj9/shot_0.jpg" alt="原视频人物" className="lp-deep-video" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="https://video-redesign-sh.oss-cn-shanghai.aliyuncs.com/characters/cmqllhs62000h485ifn8riuj9/f705721a-30ed-4281-92d6-52164416fb8d.png" alt="生成人物形象" className="lp-deep-video" />
            </div>
            <span className="lp-deep-tag lp-left">原视频</span>
            <span className="lp-deep-tag lp-right">视频重塑</span>
            <div className="lp-deep-split" />
          </div>
          <div className="lp-deep-text">
            <div className="lp-sec-kicker">核心技术</div>
            <h2>为什么人物一致性很重要？</h2>
            <p>原始视频重塑后，同一人物在不同镜头中始终保持面容、服装、体态的高度一致。</p>
            <p>视频重塑通过<strong>角色锚定技术</strong>解决：上传参考图，AI 在全部分镜中保持人物一致。</p>
            <ul>
              <li>面容一致 — 五官结构跨镜头保持</li>
              <li>服装一致 — 颜色、款式不变</li>
              <li>体态一致 — 身材比例统一</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 使用场景 */}
      <section className="lp-scenes" id="showcase">
        <div className="lp-scenes-light" />
        <div className="lp-sec-kicker" data-lp-reveal>适用场景</div>
        <h2 data-lp-reveal>谁在用视频重塑？</h2>
        <div className="lp-scenes-grid">
          <div className="lp-scene-card" data-lp-reveal>
            <div className="lp-scene-icon"><svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg></div>
            <h3>短视频创作者</h3><p>快速把手机素材变成电影质感短片。</p>
          </div>
          <div className="lp-scene-card" data-lp-reveal>
            <div className="lp-scene-icon"><svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg></div>
            <h3>电商商家</h3><p>产品展示视频批量重塑，统一品牌调性。</p>
          </div>
          <div className="lp-scene-card" data-lp-reveal>
            <div className="lp-scene-icon"><svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg></div>
            <h3>教育培训</h3><p>课程视频升级画面，讲师形象一致。</p>
          </div>
          <div className="lp-scene-card" data-lp-reveal>
            <div className="lp-scene-icon"><svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg></div>
            <h3>企业营销</h3><p>品牌宣传片快速翻新，降低制作成本。</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-faq">
        <div className="lp-sec-kicker" data-lp-reveal>常见问题</div>
        <h2 data-lp-reveal>FAQ</h2>
        <div className="lp-faq-list">
          <div className="lp-faq-item" data-lp-reveal><h3>视频时长有限制吗？</h3><p>目前支持最长 2 分钟。更长视频可分段处理。</p></div>
          <div className="lp-faq-item" data-lp-reveal><h3>生成要多久？</h3><p>一般 3-5 分钟完成全部生成+合并。</p></div>
          <div className="lp-faq-item" data-lp-reveal><h3>生成失败怎么办？</h3><p>失败的分镜组积分自动退还，不静默扣费。</p></div>
          <div className="lp-faq-item" data-lp-reveal><h3>支持哪些输出？</h3><p>480p 快速预览，720p/1080p 超分导出，三档均免费。支持 9:16 竖屏、16:9 横屏、1:1 方形。</p></div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="lp-bottom" id="contact">
        <div className="lp-bottom-glow" />
        <h2 data-lp-reveal>亲眼看见，才会相信</h2>
        <p data-lp-reveal>查看真实案例，或联系我们了解企业方案。</p>
        <div className="lp-bottom-btns" data-lp-reveal>
          <Link href="/dashboard/showcase" className="lp-btn-primary">查看案例</Link>
          <a href="mailto:hello@example.com" className="lp-btn-ghost">联系我们</a>
        </div>
      </section>

      <footer className="lp-footer">
        <span>© 2025 视频重塑 · AI Video Redesign</span>
        <div><Link href="/showcase">案例</Link><Link href="/help">帮助</Link><Link href="/login">登录</Link></div>
      </footer>
    </div>
  )
}
