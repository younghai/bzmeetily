import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { InterpretationView, groupInterpretationItems } from '../../src/local/components/InterpretationView';
import { segmentJapaneseText } from '../../src/local/components/JapaneseText';
import { segmentKoreanText } from '../../src/local/components/KoreanText';

describe('interpretation view', () => {
  test('keeps Japanese source visible beside a failed Korean translation', () => {
    // Given
    const items = [{
      id: 'segment-1',
      sourceText: '次の議題を確認します。',
      translation: null,
      error: '번역 모델 연결 실패',
      timestamp: 12,
    }];

    // When
    const html = renderToStaticMarkup(
      <InterpretationView open items={items} pending onClose={() => {}} />,
    );

    // Then
    expect(html).toContain('role="dialog"');
    expect(html).toContain('lang="ja"');
    expect(html).toContain('確認します。');
    expect(html).toContain('lang="ko"');
    expect(html).toContain('role="alert"');
    expect(html.match(/tabindex="0"/g)?.length).toBe(2);
  });

  test('keeps each speech turn in reading order and individually reachable from the timeline', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `chunk-${index}`,
      sourceText: `原文${index}。`,
      translation: index === 3 ? null : `번역 ${index}.`,
      error: index === 3 ? '연결 확인 필요' : null,
    }));
    const groups = groupInterpretationItems(items);
    expect(groups.map((group) => group.length)).toEqual(Array(8).fill(1));
    expect(groups.flat()).toEqual(items);
    const html = renderToStaticMarkup(<InterpretationView open items={items} onClose={() => {}} />);
    expect(html.match(/<article/g)?.length).toBe(16);
    expect(html.match(/대화 보기/g)?.length).toBe(8);
    expect(html).toContain('연결 확인 필요');
    expect(html.replace(/<[^>]*>/g, '')).toContain(items.map((item) => item.sourceText).join(''));
  });

  test('shows earlier dialogue in a timeline while later translation arrives', () => {
    // Given: a later caption is pending after an earlier translated exchange.
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: `turn-${index}`,
      sourceText: `発言${index}。`,
      translation: index === 6 ? null : `발언 ${index}.`,
      timestamp: `0:${String(index * 5).padStart(2, '0')}`,
    }));

    // When: the live interpretation view renders the new exchange.
    const html = renderToStaticMarkup(<InterpretationView open items={items} pending onClose={() => {}} />);

    // Then: earlier dialogue remains discoverable in the visible timeline.
    expect(html).toContain('aria-label="대화 타임라인"');
    expect(html).toContain('대화 타임라인 · 7개');
    expect(html.match(/대화 보기/g)?.length).toBe(7);
    expect(html).toContain('처음 대화');
    expect(html).toContain('発言0。');
    expect(html).toContain('발언 0.');
    expect(html).toContain('최근 대화');
  });

  test('does not render an inactive dialog', () => {
    // Given
    const view = <InterpretationView open={false} items={[]} onClose={() => {}} />;

    // When
    const html = renderToStaticMarkup(view);

    // Then
    expect(html).toBe('');
  });

  test('groups Japanese compounds and suffixes without changing visible text', () => {
    // Given
    const source = 'これは同時通訳機能を確認してからサポートページを改善します。';

    // When
    const units = segmentJapaneseText(source);

    // Then
    expect(units).toEqual(['これは', '同時通訳機能を', '確認してから', 'サポートページを', '改善します。']);
    expect(units.join('')).toBe(source);
    expect(segmentJapaneseText('こんにちは。これは確認です。')).toEqual(['こんにちは。', 'これは', '確認です。']);
  });

  test('keeps common Korean dependent phrases together without changing spaces', () => {
    // Given
    const source = '기능을 확인하기 위한 테스트 후 검색하기 쉽게 만듭니다.';

    // When
    const units = segmentKoreanText(source);

    // Then
    expect(units).toEqual(['기능을', ' ', '확인하기 위한', ' ', '테스트 후', ' ', '검색하기 쉽게', ' ', '만듭니다.']);
    expect(units.join('')).toBe(source);
    expect(segmentKoreanText('방법에 대해 결정되지 않았습니다.')).toEqual(['방법에 대해', ' ', '결정되지 않았습니다.']);
  });
});
