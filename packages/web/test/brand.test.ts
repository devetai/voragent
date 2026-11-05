import { describe, expect, it } from 'vitest';
import { Logo } from '../src/components/Logo';
import { SnakeLoader } from '../src/components/SnakeLoader';
import { ProviderIcon, resolveProviderKey, PROVIDER_BRAND_META } from '../src/components/ProviderIcon';
import React from 'react';
import { renderToString } from 'react-dom/server';

describe('Brand & UI Components', () => {
  describe('ProviderIcon component', () => {
    it('resolves opencode provider key and metadata', () => {
      expect(resolveProviderKey('opencode')).toBe('opencode');
      expect(resolveProviderKey('OpenCode CLI')).toBe('opencode');
      expect(PROVIDER_BRAND_META.opencode.color).toBe('#059669');
      expect(PROVIDER_BRAND_META.opencode.label).toBe('OpenCode');
    });

    it('renders opencode vector icon with emerald terminal badge', () => {
      const html = renderToString(React.createElement(ProviderIcon, { provider: 'opencode', size: 16 }));
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('#059669');
      expect(html).toContain('#ECFDF5');
    });
  });

  describe('Logo component', () => {
    it('renders default ouroboros logo with SVG icon and eye mask', () => {
      const html = renderToString(React.createElement(Logo, { size: 32 }));
      expect(html).toContain('logo-wrap');
      expect(html).toContain('viewBox="0 0 32 32"');
      expect(html).toContain('class="logo-icon"');
      expect(html).toContain('mask=');
      expect(html).toContain('width="32"');
    });

    it('renders wordmark when showWordmark is true', () => {
      const html = renderToString(React.createElement(Logo, { showWordmark: true }));
      expect(html).toContain('with-wordmark');
      expect(html).toContain('voragent');
    });

    it('supports alternative logo variants (coiled, v-monogram)', () => {
      const htmlMono = renderToString(React.createElement(Logo, { variant: 'v-monogram' }));
      expect(htmlMono).toContain('logo-icon');

      const htmlCoiled = renderToString(React.createElement(Logo, { variant: 'coiled' }));
      expect(htmlCoiled).toContain('logo-icon');
    });
  });

  describe('SnakeLoader component', () => {
    it('renders ouroboros animated logo variant as default', () => {
      const html = renderToString(React.createElement(SnakeLoader, { label: 'Đang tải…' }));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('snake-loader-ouroboros');
      expect(html).toContain('ouro-grow-svg');
      expect(html).toContain('ouro-grow-body');
      expect(html).toContain('ouro-grow-eye-dot');
      expect(html).toContain('Đang tải…');
    });

    it('renders fade and pulse variants', () => {
      const htmlFade = renderToString(React.createElement(SnakeLoader, { variant: 'fade' }));
      expect(htmlFade).toContain('ouro-fade-body');

      const htmlPulse = renderToString(React.createElement(SnakeLoader, { variant: 'pulse' }));
      expect(htmlPulse).toContain('ouro-pulse-body');
    });

    it('renders dispatch variant with boss snake and baby snakes', () => {
      const html = renderToString(React.createElement(SnakeLoader, { variant: 'dispatch', label: 'Đang giao việc…' }));
      expect(html).toContain('snake-loader-dispatch');
      expect(html).toContain('dispatch-boss');
      expect(html).toContain('dispatch-parcel');
      expect(html).toContain('dispatch-baby');
      expect(html).toContain('Đang giao việc…');
    });

    it('renders infinity variant with figure-8 path', () => {
      const html = renderToString(React.createElement(SnakeLoader, { variant: 'infinity', size: 'md' }));
      expect(html).toContain('snake-loader-infinity');
      expect(html).toContain('infinity-snake-path');
    });

    it('renders wave variant with segments', () => {
      const html = renderToString(React.createElement(SnakeLoader, { variant: 'wave', size: 'sm' }));
      expect(html).toContain('snake-loader-wave');
      expect(html).toContain('wave-seg');
      expect(html).toContain('size-sm');
    });

    it('renders dots variant with dot items', () => {
      const html = renderToString(React.createElement(SnakeLoader, { variant: 'dots', size: 'lg' }));
      expect(html).toContain('snake-loader-dots');
      expect(html).toContain('dot');
      expect(html).toContain('size-lg');
    });
  });
});
