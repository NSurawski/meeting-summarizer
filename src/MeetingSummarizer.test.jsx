import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import MeetingSummarizer from './MeetingSummarizer'

// --- Fixtures ---

const MOCK_SUMMARY = {
  title: 'Test Meeting',
  tldr: 'Test TL;DR content.',
  topics: [{ title: 'Topic A', summary: 'We discussed A.' }],
  decisions: [{ decision: 'Use React', context: 'Team voted' }],
  actionItems: [{ task: 'Write tests', owner: 'Alice', due: 'Friday' }],
  openQuestions: [{ question: 'Timeline unclear?' }],
}

function makeSavedMeeting(overrides = {}) {
  return {
    id: 'ms_1000',
    savedAt: '2024-01-01T00:00:00.000Z',
    title: 'Previous Meeting',
    actionItems: [{ task: 'Old task', owner: 'Bob', due: 'TBD', resolved: false }],
    openQuestions: [{ question: 'Old question?', resolved: false }],
    ...overrides,
  }
}

// --- Fetch helpers ---

function mockFetchSuccess(summary = MOCK_SUMMARY) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ text: JSON.stringify(summary) }] }),
  })
}

function mockFetchError(status) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({}),
  })
}

// Fill transcript + API key with fireEvent then click submit.
// fireEvent.change is more reliable than userEvent.type for controlled inputs
// in React 18 concurrent mode.
function fillAndSubmit(transcript = 'Some transcript content', apiKey = 'sk-ant-test') {
  fireEvent.change(screen.getByPlaceholderText(/paste your meeting transcript/i), {
    target: { value: transcript },
  })
  fireEvent.change(screen.getByPlaceholderText('sk-ant-...'), {
    target: { value: apiKey },
  })
  fireEvent.click(screen.getByRole('button', { name: /generate summary/i }))
}

// --- Setup / teardown ---

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// --- Test suites ---

describe('rendering', () => {
  it('shows the app title', () => {
    render(<MeetingSummarizer />)
    expect(screen.getByText('Meeting Summarizer')).toBeInTheDocument()
  })

  it('shows "no meetings" placeholder when localStorage is empty', () => {
    render(<MeetingSummarizer />)
    expect(screen.getByText(/no meetings summarized yet/i)).toBeInTheDocument()
  })

  it('shows the transcript textarea by default', () => {
    render(<MeetingSummarizer />)
    expect(
      screen.getByPlaceholderText(/paste your meeting transcript/i)
    ).toBeInTheDocument()
  })
})

describe('word count', () => {
  it('shows 0 words for an empty textarea', () => {
    render(<MeetingSummarizer />)
    expect(screen.getByText('0 words')).toBeInTheDocument()
  })

  it('updates word count as the user types', async () => {
    render(<MeetingSummarizer />)
    fireEvent.change(screen.getByPlaceholderText(/paste your meeting transcript/i), {
      target: { value: 'hello world foo' },
    })
    expect(screen.getByText('3 words')).toBeInTheDocument()
  })
})

describe('load sample', () => {
  it('populates the textarea with the sample transcript', async () => {
    const user = userEvent.setup()
    render(<MeetingSummarizer />)
    await user.click(screen.getByText(/load sample/i))
    const textarea = screen.getByPlaceholderText(/paste your meeting transcript/i)
    expect(textarea.value).toContain('Sarah')
    expect(textarea.value.length).toBeGreaterThan(200)
  })
})

describe('localStorage initialization', () => {
  it('reads saved meetings from localStorage on mount', () => {
    localStorage.setItem('meetingSummaries', JSON.stringify([makeSavedMeeting()]))
    render(<MeetingSummarizer />)
    expect(screen.getByText('Old task')).toBeInTheDocument()
  })

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('meetingSummaries', 'not valid json {{{')
    expect(() => render(<MeetingSummarizer />)).not.toThrow()
    expect(screen.getByText(/no meetings summarized yet/i)).toBeInTheDocument()
  })

  it('reads the saved API key from localStorage', () => {
    localStorage.setItem('anthropicApiKey', 'sk-ant-saved')
    render(<MeetingSummarizer />)
    expect(screen.getByPlaceholderText('sk-ant-...').value).toBe('sk-ant-saved')
  })
})

describe('follow-up tracker', () => {
  it('shows unresolved item count in the tracker header', () => {
    localStorage.setItem('meetingSummaries', JSON.stringify([makeSavedMeeting()]))
    render(<MeetingSummarizer />)
    expect(screen.getByText(/follow-up tracker \(2 open\)/i)).toBeInTheDocument()
  })

  it('shows "all items resolved" banner when everything is resolved', () => {
    const meeting = makeSavedMeeting({
      actionItems: [{ task: 'Done', owner: 'Bob', due: 'TBD', resolved: true }],
      openQuestions: [{ question: 'Done?', resolved: true }],
    })
    localStorage.setItem('meetingSummaries', JSON.stringify([meeting]))
    render(<MeetingSummarizer />)
    expect(screen.getByText(/all items resolved/i)).toBeInTheDocument()
  })

  it('toggles an item to resolved on click and persists to localStorage', async () => {
    const user = userEvent.setup()
    localStorage.setItem('meetingSummaries', JSON.stringify([makeSavedMeeting()]))
    render(<MeetingSummarizer />)

    await user.click(screen.getByText('Old task'))

    // One item resolved → 1 still open
    expect(screen.getByText(/follow-up tracker \(1 open\)/i)).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('meetingSummaries'))
    expect(saved[0].actionItems[0].resolved).toBe(true)
  })

  it('resolves all items with "mark all resolved"', async () => {
    const user = userEvent.setup()
    localStorage.setItem('meetingSummaries', JSON.stringify([makeSavedMeeting()]))
    render(<MeetingSummarizer />)

    await user.click(screen.getByText(/mark all resolved/i))

    expect(screen.getByText(/all items resolved/i)).toBeInTheDocument()
    const saved = JSON.parse(localStorage.getItem('meetingSummaries'))
    expect(saved[0].actionItems[0].resolved).toBe(true)
    expect(saved[0].openQuestions[0].resolved).toBe(true)
  })

  it('clears all history and resets to the empty state', async () => {
    const user = userEvent.setup()
    localStorage.setItem('meetingSummaries', JSON.stringify([makeSavedMeeting()]))
    render(<MeetingSummarizer />)

    await user.click(screen.getByText(/clear history/i))

    expect(screen.getByText(/no meetings summarized yet/i)).toBeInTheDocument()
    expect(localStorage.getItem('meetingSummaries')).toBeNull()
  })
})

describe('summarize: input validation', () => {
  it('disables the submit button when the transcript is empty', () => {
    render(<MeetingSummarizer />)
    expect(screen.getByRole('button', { name: /generate summary/i })).toBeDisabled()
  })

  it('shows an error when no API key is provided', () => {
    render(<MeetingSummarizer />)
    fireEvent.change(screen.getByPlaceholderText(/paste your meeting transcript/i), {
      target: { value: 'Some meeting text here' },
    })
    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }))
    expect(screen.getByText(/please enter your anthropic api key/i)).toBeInTheDocument()
  })
})

describe('summarize: API error handling', () => {
  it('shows "Invalid API key" error on 401', async () => {
    mockFetchError(401)
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/invalid api key/i)).toBeInTheDocument()
    )
  })

  it('shows "Rate limit exceeded" error on 429', async () => {
    mockFetchError(429)
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument()
    )
  })

  it('shows "temporarily overloaded" error on 529', async () => {
    mockFetchError(529)
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/temporarily overloaded/i)).toBeInTheDocument()
    )
  })

  it('shows "Network error" on a fetch TypeError', async () => {
    global.fetch = vi.fn().mockRejectedValue(
      Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' })
    )
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    )
  })

  it('shows "Failed to parse" error when the API returns non-JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: 'not json at all' }] }),
    })
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/failed to parse/i)).toBeInTheDocument()
    )
  })

  it('shows "missing required fields" error when title or tldr is absent', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: JSON.stringify({ topics: [] }) }] }),
    })
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByText(/missing required fields/i)).toBeInTheDocument()
    )
  })
})

describe('summarize: success', () => {
  async function renderAndSummarize(summary = MOCK_SUMMARY) {
    mockFetchSuccess(summary)
    render(<MeetingSummarizer />)
    fillAndSubmit()
    // The summary title appears in both the <h2> header and the tracker group label,
    // so use the heading role to target the summary view specifically.
    await waitFor(() => screen.getByRole('heading', { level: 2, name: summary.title }))
  }

  it('displays the summary title and TL;DR', async () => {
    await renderAndSummarize()
    expect(screen.getByRole('heading', { level: 2, name: 'Test Meeting' })).toBeInTheDocument()
    expect(screen.getByText('Test TL;DR content.')).toBeInTheDocument()
  })

  it('saves the meeting to localStorage with resolved: false flags', async () => {
    await renderAndSummarize()
    const saved = JSON.parse(localStorage.getItem('meetingSummaries'))
    expect(saved).toHaveLength(1)
    expect(saved[0].title).toBe('Test Meeting')
    expect(saved[0].actionItems[0].task).toBe('Write tests')
    expect(saved[0].actionItems[0].resolved).toBe(false)
    expect(saved[0].openQuestions[0].resolved).toBe(false)
  })

  it('strips markdown code fences from the API response', async () => {
    const fenced = '```json\n' + JSON.stringify(MOCK_SUMMARY) + '\n```'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ text: fenced }] }),
    })
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Test Meeting' })).toBeInTheDocument()
    )
  })

  it('shows action item + open question count in the confirmation line', async () => {
    await renderAndSummarize()
    expect(
      screen.getByText(/1 action items \+ 1 open questions saved to tracker/i)
    ).toBeInTheDocument()
  })
})

describe('VTT file parsing', () => {
  it('strips WEBVTT headers, timestamps, and NOTE lines (unit test)', () => {
    const vttContent = [
      'WEBVTT',
      '',
      'NOTE This is a note',
      '',
      '00:00:01.000 --> 00:00:03.000',
      'Hello world',
      '',
      '00:00:04.000 --> 00:00:06.000',
      'This is a test',
    ].join('\n')

    const parsed = vttContent
      .split('\n')
      .filter((line) => !/^WEBVTT|^\d{2}:\d{2}|^NOTE/.test(line) && line.trim() !== '')
      .join('\n')
      .trim()

    expect(parsed).toBe('Hello world\nThis is a test')
  })

  it('loads a .vtt file and strips VTT metadata from the textarea', async () => {
    const vttContent = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello from VTT'

    let capturedReader
    class MockFileReader {
      constructor() { capturedReader = this; this.onload = null }
      readAsText = vi.fn()
    }
    vi.stubGlobal('FileReader', MockFileReader)

    render(<MeetingSummarizer />)
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, {
      target: { files: [new File([vttContent], 'transcript.vtt', { type: 'text/vtt' })] },
    })

    await act(async () => {
      capturedReader.onload({ target: { result: vttContent } })
    })

    const textarea = screen.getByPlaceholderText(/paste your meeting transcript/i)
    expect(textarea.value).toContain('Hello from VTT')
    expect(textarea.value).not.toContain('WEBVTT')
    expect(textarea.value).not.toContain('00:00:01')
  })

  it('loads a plain .txt file without stripping content', async () => {
    const txtContent = 'Alice: Let us start.\nBob: Agreed.'

    let capturedReader
    class MockFileReader {
      constructor() { capturedReader = this; this.onload = null }
      readAsText = vi.fn()
    }
    vi.stubGlobal('FileReader', MockFileReader)

    render(<MeetingSummarizer />)
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, {
      target: { files: [new File([txtContent], 'notes.txt', { type: 'text/plain' })] },
    })

    await act(async () => {
      capturedReader.onload({ target: { result: txtContent } })
    })

    expect(screen.getByPlaceholderText(/paste your meeting transcript/i).value).toBe(txtContent)
  })
})

describe('copy all', () => {
  it('writes a formatted markdown summary to the clipboard', async () => {
    // Redefine inside the test so the mock survives vi.clearAllMocks() from prior tests.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, writable: true,
      value: { writeText },
    })

    mockFetchSuccess()
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Test Meeting' }))

    fireEvent.click(screen.getByText(/copy all/i))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const written = writeText.mock.calls[0][0]
    expect(written).toContain('# Test Meeting')
    expect(written).toContain('Test TL;DR content.')
    expect(written).toContain('Write tests')
    expect(written).toContain('Owner: Alice')
    expect(written).toContain('Timeline unclear?')
  })
})

describe('download PDF', () => {
  it('opens a print window with summary content', async () => {
    const mockWrite = vi.fn()
    const mockClose = vi.fn()
    const mockFocus = vi.fn()
    const mockPrint = vi.fn()
    vi.stubGlobal('open', vi.fn().mockReturnValue({
      document: { write: mockWrite, close: mockClose },
      focus: mockFocus,
      print: mockPrint,
    }))

    mockFetchSuccess()
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Test Meeting' }))

    fireEvent.click(screen.getByText(/download pdf/i))

    expect(window.open).toHaveBeenCalledWith('', '_blank')
    expect(mockWrite).toHaveBeenCalled()
    const written = mockWrite.mock.calls[0][0]
    expect(written).toContain('Test Meeting')
    expect(written).toContain('Test TL;DR content.')
    expect(written).toContain('Write tests')
    expect(written).toContain('Alice')
    expect(written).toContain('Timeline unclear?')
    expect(mockPrint).toHaveBeenCalled()
  })
})

describe('reset', () => {
  it('returns to the transcript input after clicking "New transcript"', async () => {
    const user = userEvent.setup()
    mockFetchSuccess()
    render(<MeetingSummarizer />)
    fillAndSubmit()
    await waitFor(() => screen.getByRole('heading', { level: 2, name: 'Test Meeting' }))

    await user.click(screen.getByText(/← new transcript/i))

    expect(
      screen.getByPlaceholderText(/paste your meeting transcript/i)
    ).toBeInTheDocument()
    // Summary heading is gone; meeting title may still appear in tracker group label
    expect(screen.queryByRole('heading', { level: 2, name: 'Test Meeting' })).not.toBeInTheDocument()
  })
})
