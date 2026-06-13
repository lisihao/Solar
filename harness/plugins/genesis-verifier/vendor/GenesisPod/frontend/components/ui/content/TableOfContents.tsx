'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { List, X } from 'lucide-react';

interface TOCHeading {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  /** HTML content to extract headings from */
  content: string;
  /** Ref to the scrollable content container */
  containerRef: React.RefObject<HTMLElement>;
  /** Optional className for the TOC container */
  className?: string;
  /** Theme mode for styling */
  theme?: 'light' | 'sepia' | 'dark';
  /** Whether TOC is initially collapsed */
  defaultCollapsed?: boolean;
}

// Helper function to decode HTML entities
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

// Check if text looks like a valid heading
function isValidHeadingText(text: string): boolean {
  if (text.length < 2 || text.length > 150) return false;
  // Filter out things that look like metadata or navigation
  if (
    /^(share|tweet|email|print|subscribe|read more|continue|next|prev)/i.test(
      text
    )
  )
    return false;
  if (/^\d+$/.test(text)) return false; // Just numbers
  if (/^[\d\s,./:-]+$/.test(text)) return false; // Dates or numbers only
  return true;
}

// Extract headings from HTML content
function extractHeadings(html: string): TOCHeading[] {
  const headings: TOCHeading[] = [];

  // Strategy 1: Match h1, h2, h3, h4 tags (most common and reliable)
  const headingRegex = /<h([1-4])([^>]*)>([\s\S]*?)<\/h[1-4]>/gi;

  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    // Extract text content, removing any nested tags
    const text = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, '')).trim();

    if (isValidHeadingText(text)) {
      headings.push({ id: `toc-heading-${headings.length}`, text, level });
    }
  }

  // If found enough headings with h-tags, return them
  if (headings.length >= 2) {
    return headings;
  }

  // Strategy 2: Look for <strong> or <b> tags in separate paragraphs (common in reports)
  // Match patterns like: <p><strong>Section Title</strong></p> or <p><b>Section Title</b></p>
  const strongHeadingRegex =
    /<p[^>]*>\s*<(strong|b)[^>]*>([\s\S]*?)<\/\1>\s*<\/p>/gi;

  while ((match = strongHeadingRegex.exec(html)) !== null) {
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '')).trim();
    // Only treat as heading if it looks like a section title (not too long, starts with capital)
    if (isValidHeadingText(text) && text.length < 100 && /^[A-Z]/.test(text)) {
      // Check it's not just emphasized text within a sentence
      if (!text.includes('.') || text.endsWith(':')) {
        headings.push({ id: `toc-heading-${headings.length}`, text, level: 2 });
      }
    }
  }

  if (headings.length >= 2) {
    return headings;
  }

  // Strategy 3: Look for standalone bold text that appears to be headers
  // Pattern: <strong>...</strong> or <b>...</b> followed by newline or </p>
  const standaloneBoldRegex =
    /<(strong|b)[^>]*>([\s\S]*?)<\/\1>(?:\s*(?:<br\s*\/?>|<\/p>|\n))/gi;

  const boldCandidates: TOCHeading[] = [];
  while ((match = standaloneBoldRegex.exec(html)) !== null) {
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '')).trim();
    if (
      isValidHeadingText(text) &&
      text.length >= 3 &&
      text.length < 80 &&
      /^[A-Z]/.test(text) &&
      !text.includes('.')
    ) {
      boldCandidates.push({
        id: `toc-heading-${headings.length + boldCandidates.length}`,
        text,
        level: 2,
      });
    }
  }

  if (boldCandidates.length >= 2) {
    return [...headings, ...boldCandidates];
  }

  // Strategy 4: Fallback to markdown-style or plain text headings
  if (headings.length === 0) {
    const lines = html.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/<[^>]+>/g, '').trim();

      // Check for markdown-style headings
      const mdMatch = line.match(/^(#{1,4})\s+(.+)$/);
      if (mdMatch) {
        const level = mdMatch[1].length;
        const text = decodeHtmlEntities(mdMatch[2]).trim();
        if (isValidHeadingText(text)) {
          headings.push({ id: `toc-heading-${headings.length}`, text, level });
        }
        continue;
      }

      // Check for section headers (all caps, short text)
      if (
        line.length > 3 &&
        line.length < 80 &&
        line === line.toUpperCase() &&
        /^[A-Z\s\d]+$/.test(line)
      ) {
        headings.push({
          id: `toc-heading-${headings.length}`,
          text: line,
          level: 2,
        });
        continue;
      }

      // Check for numbered sections like "1. Introduction" or "Section 1:"
      const numberedMatch = line.match(
        /^(?:Section\s+)?(\d+\.?)\s+([A-Z][^.]*?)$/i
      );
      if (numberedMatch && line.length < 100) {
        headings.push({
          id: `toc-heading-${headings.length}`,
          text: decodeHtmlEntities(numberedMatch[2]).trim(),
          level: 2,
        });
        continue;
      }

      // Check for colon-terminated headers like "Key Findings:"
      if (
        line.length > 5 &&
        line.length < 60 &&
        line.endsWith(':') &&
        /^[A-Z]/.test(line) &&
        !line.includes('.')
      ) {
        headings.push({
          id: `toc-heading-${headings.length}`,
          text: line,
          level: 2,
        });
      }
    }
  }

  return headings;
}

/**
 * Table of Contents component for document navigation
 *
 * Features:
 * - Floating/absolute positioned, doesn't affect layout
 * - Extracts headings from HTML content
 * - Highlights current section based on scroll position
 * - Smooth scroll to section on click
 * - Collapsible panel
 */
export default function TableOfContents({
  content,
  containerRef,
  className = '',
  theme = 'light',
  defaultCollapsed = true,
}: TableOfContentsProps) {
  const [headings, setHeadings] = useState<TOCHeading[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [tocPosition, setTocPosition] = useState<{ top: number; left: number }>(
    {
      top: 100,
      left: 20,
    }
  );
  const tocRef = useRef<HTMLDivElement>(null);

  // Extract headings from content
  useEffect(() => {
    const extracted = extractHeadings(content);
    setHeadings(extracted);

    // Add IDs to actual heading elements in the DOM after a small delay
    // to ensure the DOM has been rendered
    const timeoutId = setTimeout(() => {
      if (containerRef.current && extracted.length > 0) {
        let idx = 0;

        // First, try to match h1-h4 elements
        const headingElements =
          containerRef.current.querySelectorAll('h1, h2, h3, h4');
        headingElements.forEach((el) => {
          const text = el.textContent?.trim() || '';
          if (isValidHeadingText(text)) {
            el.id = `toc-heading-${idx}`;
            idx++;
          }
        });

        // If we found headings in DOM matching our extracted count, we're done
        if (idx >= extracted.length) return;

        // Otherwise, look for strong/b tags that might be headings
        // Only if we detected strong/b tags as headings in extraction
        const strongElements = containerRef.current.querySelectorAll(
          'p > strong:only-child, p > b:only-child'
        );
        strongElements.forEach((el) => {
          const text = el.textContent?.trim() || '';
          // Match the criteria used in extraction
          if (
            isValidHeadingText(text) &&
            text.length < 100 &&
            /^[A-Z]/.test(text) &&
            (!text.includes('.') || text.endsWith(':'))
          ) {
            // Assign ID to the parent p element for better scroll targeting
            const parent = el.parentElement;
            if (parent && !parent.id) {
              parent.id = `toc-heading-${idx}`;
              idx++;
            }
          }
        });

        // Also check for standalone strong/b elements
        if (idx < extracted.length) {
          const allBoldElements =
            containerRef.current.querySelectorAll('strong, b');
          allBoldElements.forEach((el) => {
            if (idx >= extracted.length) return;
            const text = el.textContent?.trim() || '';
            // Check if this text matches one of our extracted headings
            const matchesExtracted = extracted.some(
              (h) => h.text === text && !document.getElementById(h.id)
            );
            if (matchesExtracted && !el.id) {
              el.id = `toc-heading-${idx}`;
              idx++;
            }
          });
        }
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [content, containerRef]);

  // Track active section based on scroll position
  const handleScroll = useCallback(() => {
    if (!containerRef.current || headings.length === 0) return;

    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;

    // Find the heading that is currently in view
    let currentActiveId = '';

    for (const heading of headings) {
      const element = document.getElementById(heading.id);
      if (element) {
        const rect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const relativeTop = rect.top - containerRect.top;

        // If the heading is in the top half of the viewport, it's active
        if (relativeTop <= clientHeight / 3) {
          currentActiveId = heading.id;
        }
      }
    }

    // If we're at the bottom, activate the last heading
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      currentActiveId = headings[headings.length - 1]?.id || '';
    }

    // If we're at the top, activate the first heading
    if (scrollTop < 100 && headings.length > 0) {
      currentActiveId = headings[0].id;
    }

    if (currentActiveId !== activeId) {
      setActiveId(currentActiveId);
    }
  }, [headings, activeId, containerRef]);

  // Add scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, containerRef]);

  // Calculate and update TOC position based on container position
  // Use a fixed anchor point (collapsed button width) to prevent position drift
  useEffect(() => {
    const updatePosition = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      // Always use the collapsed button width (40px) as anchor point
      // This prevents position drift when expanding/collapsing
      const anchorWidth = 40;
      const margin = 16;
      // Minimum left position to avoid overlapping with sidebar
      // Sidebar expanded ~200px, collapsed ~64px, so we use a safe minimum to handle both cases
      const minLeft = 120;
      const calculatedLeft = containerRect.left - anchorWidth - margin;
      const left = Math.max(minLeft, calculatedLeft);
      const top = containerRect.top + 32; // 32px from top of container

      setTocPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [containerRef]); // Remove isCollapsed from dependencies to prevent recalculation on toggle

  // Scroll to heading on click
  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      // Try scrollIntoView first as a reliable fallback
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      setActiveId(id);
    } else {
      // Element not found - try to find by matching text content
      const index = parseInt(id.replace('toc-heading-', ''), 10);
      if (!isNaN(index) && containerRef.current && headings[index]) {
        const targetText = headings[index].text;

        // First try h1-h4 elements
        const headingElements =
          containerRef.current.querySelectorAll('h1, h2, h3, h4');
        let found = false;

        for (const el of Array.from(headingElements)) {
          if (el.textContent?.trim() === targetText) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.id = id;
            setActiveId(id);
            found = true;
            break;
          }
        }

        // If not found, try strong/b elements
        if (!found) {
          const boldElements =
            containerRef.current.querySelectorAll('strong, b');
          for (const el of Array.from(boldElements)) {
            if (el.textContent?.trim() === targetText) {
              // Scroll to parent for better positioning
              const target = el.parentElement || el;
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
              target.id = id;
              setActiveId(id);
              found = true;
              break;
            }
          }
        }

        // Final fallback: scroll to nth valid heading element
        if (!found) {
          const validHeadings = Array.from(headingElements).filter((el) =>
            isValidHeadingText(el.textContent?.trim() || '')
          );
          if (validHeadings[index]) {
            validHeadings[index].scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            });
            validHeadings[index].id = id;
            setActiveId(id);
          }
        }
      }
    }
  };

  // Theme styles
  const themeStyles = {
    light: {
      bg: 'bg-white',
      border: 'border-gray-200',
      text: 'text-gray-600',
      textActive: 'text-red-600',
      textHover: 'hover:text-gray-900',
      activeIndicator: 'bg-red-500',
      header: 'text-gray-900',
      headerBg: 'bg-gray-50',
      shadow: 'shadow-lg',
      buttonBg: 'bg-white hover:bg-gray-50',
    },
    sepia: {
      bg: 'bg-[#FBF7F0]',
      border: 'border-[#E8DFD0]',
      text: 'text-[#8B7355]',
      textActive: 'text-[#8B4513]',
      textHover: 'hover:text-[#5C4B37]',
      activeIndicator: 'bg-[#8B4513]',
      header: 'text-[#3D2E1C]',
      headerBg: 'bg-[#F5EFE6]',
      shadow: 'shadow-lg',
      buttonBg: 'bg-[#FBF7F0] hover:bg-[#F5EFE6]',
    },
    dark: {
      bg: 'bg-[#1A1A1A]',
      border: 'border-gray-700',
      text: 'text-gray-400',
      textActive: 'text-red-400',
      textHover: 'hover:text-gray-200',
      activeIndicator: 'bg-red-500',
      header: 'text-gray-200',
      headerBg: 'bg-gray-800',
      shadow: 'shadow-2xl',
      buttonBg: 'bg-gray-800 hover:bg-gray-700',
    },
  };

  const styles = themeStyles[theme];

  // Don't render if no headings
  if (headings.length === 0) {
    return null;
  }

  return (
    <div
      ref={tocRef}
      className={`fixed z-40 ${className}`}
      style={{
        top: `${tocPosition.top}px`,
        left: `${tocPosition.left}px`,
      }}
    >
      {/* Toggle button - always rendered as anchor point */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`flex h-10 w-10 items-center justify-center rounded-full border ${styles.border} ${styles.buttonBg} ${styles.shadow} transition-all duration-200 hover:scale-105`}
        title={isCollapsed ? '展开目录' : '收起目录'}
      >
        {isCollapsed ? (
          <List className={`h-5 w-5 ${styles.text}`} />
        ) : (
          <X className={`h-4 w-4 ${styles.text}`} />
        )}
      </button>

      {/* Expanded panel - positioned relative to button, expands to the right */}
      {!isCollapsed && (
        <div
          className={`absolute left-12 top-0 w-64 rounded-xl border ${styles.border} ${styles.bg} ${styles.shadow} animate-in fade-in slide-in-from-left-2 overflow-hidden duration-200`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between px-4 py-3 ${styles.headerBg} border-b ${styles.border}`}
          >
            <span className={`text-sm font-medium ${styles.header}`}>
              本页目录
            </span>
          </div>

          {/* TOC List */}
          <nav className="max-h-80 overflow-y-auto p-3">
            <ul className="space-y-1">
              {headings.map((heading) => {
                const isActive = activeId === heading.id;
                const indentClass =
                  heading.level === 1
                    ? 'pl-0'
                    : heading.level === 2
                      ? 'pl-0'
                      : heading.level === 3
                        ? 'pl-3'
                        : 'pl-5';

                return (
                  <li key={heading.id}>
                    <button
                      onClick={() => scrollToHeading(heading.id)}
                      className={`relative flex w-full items-start rounded-md px-2 py-1.5 text-left text-sm leading-snug transition-all ${indentClass} ${
                        isActive
                          ? `font-medium ${styles.textActive} bg-red-50`
                          : `${styles.text} ${styles.textHover} hover:bg-gray-50`
                      }`}
                    >
                      {isActive && (
                        <span
                          className={`absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full ${styles.activeIndicator}`}
                        />
                      )}
                      <span className="line-clamp-2">{heading.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </div>
  );
}
