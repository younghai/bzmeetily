import { describe, expect, test } from 'bun:test';

import { SpeakerTracker } from '../../src/local/native/speakerTracker';

describe('speaker tracker', () => {
  test('majority weight wins within an utterance', () => {
    const tracker = new SpeakerTracker();
    tracker.push({ speaker: 'mic', samples: 4800 });
    tracker.push({ speaker: 'mic', samples: 4800 });
    tracker.push({ speaker: 'system', samples: 28800 });
    expect(tracker.current()).toBe('system');
  });

  test('ties and single-source utterances default to the local user', () => {
    const tracker = new SpeakerTracker();
    tracker.push({ speaker: 'mic', samples: 1000 });
    tracker.push({ speaker: 'system', samples: 1000 });
    expect(tracker.current()).toBe('mic');

    const remoteOnly = new SpeakerTracker();
    remoteOnly.push({ speaker: 'system', samples: 1000 });
    expect(remoteOnly.current()).toBe('system');
  });

  test('reset clears the utterance attribution', () => {
    const tracker = new SpeakerTracker();
    tracker.push({ speaker: 'system', samples: 5000 });
    expect(tracker.current()).toBe('system');
    tracker.reset();
    expect(tracker.current()).toBe('mic'); // back to the default with no data
  });
});
