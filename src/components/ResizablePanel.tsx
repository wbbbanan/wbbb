import { useCallback, useEffect, useRef, useState } from 'react';

interface ResizablePanelProps {
  side: 'left' | 'right';
  defaultSize: number;
  minSize: number;
  maxSize: number;
  children: React.ReactNode;
  className?: string;
  storageKey?: string;
  onSizeChange?: (size: number) => void;
}

export const ResizablePanel = ({
  side,
  defaultSize,
  minSize,
  maxSize,
  children,
  className = '',
  storageKey,
  onSizeChange,
}: ResizablePanelProps): JSX.Element => {
  const [size, setSize] = useState(() => {
    if (!storageKey) return defaultSize;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed)) return Math.max(minSize, Math.min(maxSize, parsed));
      }
    } catch { /* ignore */ }
    return defaultSize;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartSize = useRef(0);

  useEffect(() => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, String(size)); } catch { /* ignore */ }
    }
  }, [size, storageKey]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartSize.current = size;
  }, [size]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = side === 'left' 
        ? e.clientX - dragStartX.current 
        : dragStartX.current - e.clientX;
      const newSize = Math.max(minSize, Math.min(maxSize, dragStartSize.current + delta));
      setSize(newSize);
      onSizeChange?.(newSize);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, side, minSize, maxSize, onSizeChange]);

  const handleStyle: React.CSSProperties = side === 'left' 
    ? { right: 0, borderRightWidth: isDragging ? '3px' : '1px' }
    : { left: 0, borderLeftWidth: isDragging ? '3px' : '1px' };

  return (
    <div 
      className={`relative shrink-0 ${className}`} 
      style={{ width: size }}
    >
      {children}
      
      {/* Resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className={`absolute top-0 bottom-0 z-50 cursor-col-resize transition-all duration-150
          ${side === 'left' ? 'border-r' : 'border-l'} 
          ${isDragging 
            ? 'border-[var(--text-secondary)] w-[3px]' 
            : 'border-transparent hover:border-[var(--text-muted)] hover:w-[4px] w-[3px]'
          }`}
        style={handleStyle}
        title="拖拽调整宽度"
      />
    </div>
  );
};
