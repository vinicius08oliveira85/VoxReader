import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import type { Chapter } from '../types';

export function Reader() {
  const { state, actions } = useApp();
  const { currentBook, chapters, currentChapter, player, settings } = state;
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [showTOC, setShowTOC] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const chapter = chapters.find(c => c.id === currentChapter?.id) || currentChapter;

  useEffect(() => {
    if (highlightedIndex >= 0 && textContainerRef.current) {
      const elements = textContainerRef.current.querySelectorAll('[data-paragraph-index]');
      const target = elements[highlightedIndex] as HTMLElement;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('bg-accent-primary/20');
      }
    }
  }, [highlightedIndex]);

  const handleParagraphClick = useCallback((index: number) => {
    setHighlightedIndex(index);
    // TODO: Seek to this paragraph in audio
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        actions.setPlayerState({ isPlaying: !player.isPlaying });
        break;
      case 'ArrowLeft':
        e.preventDefault();
        actions.setPlayerState({ currentTime: Math.max(0, player.currentTime - 10) });
        break;
      case 'ArrowRight':
        e.preventDefault();
        actions.setPlayerState({ currentTime: Math.min(player.duration, player.currentTime + 10) });
        break;
      case 'KeyN':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const currentIndex = chapters.findIndex(c => c.id === currentChapter?.id);
          if (currentIndex < chapters.length - 1) {
            actions.openBook(chapters[currentIndex + 1].id);
          }
        }
        break;
      case 'KeyP':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const currentIndex = chapters.findIndex(c => c.id === currentChapter?.id);
          if (currentIndex > 0) {
            actions.openBook(chapters[currentIndex - 1].id);
          }
        }
        break;
    }
  }, [player, chapters, currentChapter]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!currentBook || !chapter) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center p-8">
          <svg className="w-24 h-24 mx-auto mb-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.132.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.132.477-4.5 1.253"/>
          </svg>
          <p className="text-text-muted">Nenhum capítulo selecionado</p>
        </div>
      </div>
    );
  }

  const paragraphs = chapter.textContent?.split(/\n\s*\n/).filter(p => p.trim().length > 0) || [];

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <header className="bg-bg-secondary border-b border-border-light sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => actions.setView('library')}
              className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-primary transition-colors"
              aria-label="Voltar à biblioteca"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
              </svg>
            </button>
            
            <div className="flex-1 text-center px-4">
              <h1 className="font-semibold text-text-primary truncate">{currentBook.title}</h1>
              <p className="text-xs text-text-muted truncate">{chapter.title}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowTOC(!showTOC)}
                className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-primary transition-colors"
                aria-label="Sumário"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
                </svg>
              </button>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover text-text-primary transition-colors"
                aria-label="Configurações de leitura"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6 overflow-y-auto">
        <div className="prose prose-invert max-w-none">
          <h2 className="text-2xl font-bold text-text-primary mb-6">{chapter.title}</h2>
          
          <div
            ref={textContainerRef}
            className="text-text-primary leading-relaxed"
            style={{ fontSize: `${fontSize}px`, lineHeight: lineHeight }}
          >
            {paragraphs.map((paragraph, index) => (
              <p
                key={index}
                data-paragraph-index={index}
                onClick={() => handleParagraphClick(index)}
                className={`py-2 px-2 rounded-lg transition-all duration-200 cursor-pointer ${
                  index === highlightedIndex 
                    ? 'bg-accent-primary/20 ring-2 ring-accent-primary/50' 
                    : 'hover:bg-bg-tertiary'
                }`}
              >
                {paragraph.trim()}
              </p>
            ))}
          </div>
        </div>
      </main>

      {showTOC && (
        <div className="fixed inset-0 z-50 bg-bg-primary/95 backdrop-blur-sm" onClick={() => setShowTOC(false)}>
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-bg-secondary border-l border-border-light overflow-y-auto animate-slide-up">
            <div className="p-4 border-b border-border-light flex items-center justify-between">
              <h3 className="font-semibold text-text-primary">Sumário</h3>
              <button onClick={() => setShowTOC(false)} className="p-2 rounded-lg hover:bg-bg-tertiary">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-2 max-h-[calc(100vh-120px)] overflow-y-auto">
              {chapters.map((ch, index) => (
                <button
                  key={ch.id}
                  onClick={() => actions.openBook(ch.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    ch.id === chapter.id
                      ? 'bg-accent-primary/20 text-accent-primary font-medium'
                      : 'text-text-secondary hover:bg-bg-tertiary'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{index + 1}. {ch.title}</span>
                    <span className="text-xs text-text-muted">{ch.wordCount} palavras</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-bg-primary/95 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
          <div className="fixed right-0 top-0 bottom-0 w-full max-w-sm bg-bg-secondary border-l border-border-light overflow-y-auto animate-slide-up">
            <div className="p-4 border-b border-border-light flex items-center justify-between">
              <h3 className="font-semibold text-text-primary">Configurações de Leitura</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 rounded-lg hover:bg-bg-tertiary">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Tamanho da Fonte</label>
                <div className="flex items-center gap-3">
                  <button onClick={() => setFontSize(Math.max(12, fontSize - 1))} className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4"/></svg>
                  </button>
                  <input
                    type="range"
                    min="12"
                    max="28"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="flex-1 accent-accent-primary"
                  />
                  <span className="text-text-primary w-10 text-center">{fontSize}px</span>
                  <button onClick={() => setFontSize(Math.min(28, fontSize + 1))} className="p-2 rounded-lg bg-bg-tertiary hover:bg-bg-hover">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16M4 12h16"/></svg>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">Espaçamento de Linha</label>
                <input
                  type="range"
                  min="1.2"
                  max="2.5"
                  step="0.1"
                  value={lineHeight}
                  onChange={(e) => setLineHeight(Number(e.target.value))}
                  className="w-full accent-accent-primary"
                />
                <p className="text-xs text-text-muted mt-1">{lineHeight.toFixed(1)}</p>
              </div>

              <div className="pt-4 border-t border-border-light">
                <button
                  onClick={() => {
                    setFontSize(18);
                    setLineHeight(1.8);
                  }}
                  className="w-full px-4 py-2 bg-bg-tertiary hover:bg-bg-hover text-text-primary rounded-lg font-medium transition-colors"
                >
                  Restaurar Padrões
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}