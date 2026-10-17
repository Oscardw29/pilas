import React from 'react';

interface MarkdownMessageProps {
  content: string;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content }) => {
  // Función para parsear texto inline (negritas, cursivas, código inline)
  const renderInline = (text: string): React.ReactNode[] => {
    // Regex para tokens: `código`, **negrita**, *cursiva*
    const parts: React.ReactNode[] = [];
    const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.slice(lastIdx, match.index));
      }

      const token = match[0];
      if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(
          <code
            key={`c-${match.index}`}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.9em',
              color: 'var(--accent-2)',
            }}
          >
            {token.slice(1, -1)}
          </code>
        );
      } else if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={`b-${match.index}`} style={{ fontWeight: 700, color: '#fff' }}>
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(
          <em key={`i-${match.index}`} style={{ fontStyle: 'italic', color: 'var(--text-2)' }}>
            {token.slice(1, -1)}
          </em>
        );
      }

      lastIdx = regex.lastIndex;
    }

    if (lastIdx < text.length) {
      parts.push(text.slice(lastIdx));
    }

    return parts.length > 0 ? parts : [text];
  };

  // Separar líneas en bloques
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      elements.push(<div key={`sp-${i}`} style={{ height: 6 }} />);
      continue;
    }

    // Encabezados
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={`h3-${i}`} style={{ margin: '12px 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
          {renderInline(trimmed.slice(4))}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <h3 key={`h2-${i}`} style={{ margin: '14px 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--accent-2)' }}>
          {renderInline(trimmed.slice(3))}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <h2 key={`h1-${i}`} style={{ margin: '16px 0 8px', fontSize: 18, fontWeight: 800, color: '#fff' }}>
          {renderInline(trimmed.slice(2))}
        </h2>
      );
    } else if (trimmed.startsWith('> ')) {
      // Citas
      elements.push(
        <blockquote
          key={`bq-${i}`}
          style={{
            margin: '6px 0',
            padding: '6px 12px',
            borderLeft: '3px solid var(--accent)',
            background: 'rgba(99, 102, 241, 0.08)',
            borderRadius: '0 8px 8px 0',
            color: 'var(--text-2)',
            fontSize: 13.5,
          }}
        >
          {renderInline(trimmed.slice(2))}
        </blockquote>
      );
    } else if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // Listas con viñetas
      elements.push(
        <div key={`li-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '3px 0' }}>
          <span style={{ color: 'var(--accent)', fontSize: 13, lineHeight: '22px' }}>•</span>
          <div style={{ flex: 1, lineHeight: 1.5 }}>{renderInline(trimmed.slice(2))}</div>
        </div>
      );
    } else if (/^\d+\.\s/.test(trimmed)) {
      // Listas numeradas
      const numMatch = trimmed.match(/^(\d+\.)\s(.*)$/);
      if (numMatch) {
        elements.push(
          <div key={`nli-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', margin: '3px 0' }}>
            <span style={{ color: 'var(--accent-2)', fontSize: 13, fontWeight: 700, lineHeight: '22px', minWidth: 18 }}>
              {numMatch[1]}
            </span>
            <div style={{ flex: 1, lineHeight: 1.5 }}>{renderInline(numMatch[2])}</div>
          </div>
        );
      }
    } else {
      // Párrafo normal
      elements.push(
        <p key={`p-${i}`} style={{ margin: '3px 0', lineHeight: 1.5 }}>
          {renderInline(trimmed)}
        </p>
      );
    }
  }

  return <div className="markdown-body" style={{ wordBreak: 'break-word' }}>{elements}</div>;
};
