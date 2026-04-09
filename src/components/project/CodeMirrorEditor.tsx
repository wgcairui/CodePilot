"use client";

// ⚠️ 所有 import 必须在文件顶部
import { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

// language 值来自 getFileLanguage()，是显示名称（如 "typescript"、"python"），不是文件扩展名
async function getLanguageExtension(language: string): Promise<Extension | null> {
  switch (language) {
    case "javascript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true });
    }
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true, jsx: true });
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "css":
    case "scss": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "go": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    default:
      return null;
  }
}

interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  isDark: boolean;
  className?: string;
}

export function CodeMirrorEditor({
  value,
  onChange,
  language,
  isDark,
  className,
}: CodeMirrorEditorProps) {
  const [extensions, setExtensions] = useState<Extension[]>([]);

  useEffect(() => {
    getLanguageExtension(language).then((ext) => {
      setExtensions(ext ? [ext] : []);
    });
  }, [language]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={isDark ? oneDark : undefined}
      height="100%"
      className={className}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: true,
      }}
      style={{ fontSize: "11px" }}
    />
  );
}
