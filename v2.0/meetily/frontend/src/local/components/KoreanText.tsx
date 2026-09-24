type Props = {
  readonly text: string;
  readonly className?: string;
};

const DEPENDENT_WORDS = new Set(['위한', '위해', '후', '전', '때', '쉽게', '대해', '대한', '대하여']);

function isDependentWord(word: string): boolean {
  const bareWord = word.replace(/[.!?…]+$/u, '');
  return DEPENDENT_WORDS.has(bareWord) || /^않[가-힣]+$/u.test(bareWord);
}

export function segmentKoreanText(text: string): readonly string[] {
  const parts = text.split(/(\s+)/);
  const units: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === undefined || part === '') continue;
    const separator = parts[index + 1];
    const nextWord = parts[index + 2];
    if (!/^\s+$/.test(part) && separator && /^\s+$/.test(separator) && nextWord && isDependentWord(nextWord)) {
      units.push(`${part}${separator}${nextWord}`);
      index += 2;
      continue;
    }
    units.push(part);
  }
  return units;
}

export function KoreanText({ text, className }: Props) {
  return (
    <span lang="ko" className={className}>
      {segmentKoreanText(text).map((unit, index) => /^\s+$/.test(unit)
        ? unit
        : <span key={`${index}-${unit}`} className="inline-block w-max max-w-full whitespace-normal align-baseline [overflow-wrap:anywhere]">{unit}</span>)}
    </span>
  );
}
