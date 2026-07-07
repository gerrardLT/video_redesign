import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/generated/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // React 19 experimental rules - downgrade to warnings
      // These patterns (fetching data in useEffect with setState) are standard
      // and functionally correct, but React 19's new lint rules flag them.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // zen-editorial-ui-overhaul Req 8.4 / 7.4：商家端（/merchant）渐进式迁移护栏
    // 仅检测，警告级别（不阻断构建），保障 orange/amber 硬编码与非 1.5 图标线宽逐步清理。
    // 颜色一致性当前由 globals.css 中 .ll-root 的 Tailwind 色板重映射兜底交付，
    // 本规则负责把残留的硬编码标记出来，供后续渐进式替换为 --ll-* 语义变量。
    files: [
      "src/app/merchant/**/*.{ts,tsx}",
      "src/components/merchant/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // 检测 className 等字符串字面量中的 orange-*/amber-* 硬编码工具类
          selector:
            "Literal[value=/\\b(text|bg|border|ring|from|to|via|divide|outline|shadow|fill|stroke)-(orange|amber)-/]",
          message:
            "商家端禁止硬编码 orange-*/amber-* 工具类（zen-editorial Req 8.3）。请改用 --ll-* 语义变量或 shadcn 默认样式。",
        },
        {
          // 检测模板字符串中的 orange-*/amber-* 硬编码工具类
          selector:
            "TemplateElement[value.raw=/\\b(text|bg|border|ring|from|to|via|divide|outline|shadow|fill|stroke)-(orange|amber)-/]",
          message:
            "商家端禁止硬编码 orange-*/amber-* 工具类（zen-editorial Req 8.3）。请改用 --ll-* 语义变量或 shadcn 默认样式。",
        },
        {
          // 检测 lucide 图标 strokeWidth 非 1.5（v3 Zen 统一线宽，Req 2.1）
          selector:
            "JSXAttribute[name.name='strokeWidth'] Literal[value!=1.5]",
          message:
            "商家端 lucide 图标 strokeWidth 必须统一为 1.5（zen-editorial Req 2.1）。",
        },
      ],
    },
  },
];

export default eslintConfig;
