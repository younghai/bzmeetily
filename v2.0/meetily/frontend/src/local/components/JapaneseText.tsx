type Props = {
  readonly text: string;
  readonly className?: string;
};

const HAN_OR_KATAKANA = /^[\p{Script=Han}\p{Script=Katakana}ー々〆ヵヶ]+$/u;
const HIRAGANA = /^[\p{Script=Hiragana}]+$/u;
const PUNCTUATION_OR_SPACE = /^[\p{P}\p{S}\s]+$/u;

export function segmentJapaneseText(text: string): readonly string[] {
  const segments = [...new Intl.Segmenter('ja', { granularity: 'word' }).segment(text)].map((part) => part.segment);
  const units: string[] = [];
  let current = '';
  let endsWithHiragana = false;

  const flush = (): void => {
    if (current) units.push(current);
    current = '';
    endsWithHiragana = false;
  };

  for (const segment of segments) {
    if (PUNCTUATION_OR_SPACE.test(segment)) {
      current += segment;
      flush();
      continue;
    }
    if (HAN_OR_KATAKANA.test(segment)) {
      if (endsWithHiragana) flush();
      current += segment;
      continue;
    }
    if (HIRAGANA.test(segment)) {
      current += segment;
      endsWithHiragana = true;
      continue;
    }
    flush();
    current = segment;
  }
  flush();
  return units;
}

export function JapaneseText({ text, className }: Props) {
  return (
    <span lang="ja" className={className}>
      {segmentJapaneseText(text).map((unit, index) => (
        <span key={`${index}-${unit}`} className="inline-block w-max max-w-full whitespace-normal align-baseline [overflow-wrap:anywhere]">{unit}</span>
      ))}
    </span>
  );
}
