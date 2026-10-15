import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import AvatarStack from '../../components/AvatarStack.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { colourFor, initials, initialsFor, initialsStyle } from '../../lib/avatarLook.js'
import { blobToBase64, centerSquare, sourceProblem } from '../../lib/avatarImage.js'
import { renderWithProviders, users } from '../../test/render.jsx'
import { API, HttpResponse, http, server } from '../../test/server.js'
import AvatarDialog from './AvatarDialog.jsx'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

vi.mock('../../lib/avatarImage.js', async (importOriginal) => {
  const real = await importOriginal()
  // jsdom can't decode or draw images; the crop returns a fixed "PNG" so the dialog flow can be tested.
  return { ...real, cropToSquarePng: vi.fn(async () => new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    { type: 'image/png' })) }
})

const photoIndex = (items) => server.use(http.get(`${API}/avatars`, () => HttpResponse.json({ items })))
const file = (type = 'image/jpeg', size = 10) => new File([new Uint8Array(size)], 'me.jpg', { type })
const pngResponse = () => new HttpResponse(PNG_BYTES, { headers: { 'content-type': 'image/png' } })

describe('avatar image helpers', () => {
  test('centre square crops the longer side evenly', () => {
    expect(centerSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 })
    expect(centerSquare(300, 401)).toEqual({ sx: 0, sy: 50, side: 300 })
    expect(centerSquare(64, 64)).toEqual({ sx: 0, sy: 0, side: 64 })
  })

  test('only PNG, JPEG and WebP photos of a sane size are accepted', () => {
    expect(sourceProblem(file('image/png'))).toBeNull()
    expect(sourceProblem(file('image/webp'))).toBeNull()
    expect(sourceProblem(file('image/svg+xml'))).toMatch(/png, jpeg or webp/i)
    expect(sourceProblem(file('image/gif'))).toMatch(/png, jpeg or webp/i)
    expect(sourceProblem(file('text/html'))).toMatch(/png, jpeg or webp/i)
    expect(sourceProblem(file('image/jpeg', 16 * 1024 * 1024))).toMatch(/15 MB/)
    expect(sourceProblem(null)).toMatch(/choose a photo/i)
  })

  test('blobToBase64 encodes the raw bytes without a data: prefix', async () => {
    expect(await blobToBase64(new Blob([PNG_BYTES]))).toBe('iVBORw0KGgo=')
  })
})

describe('UserAvatar', () => {
  test('shows initials on a stable colour and never asks for a photo nobody has', async () => {
    let photoRequests = 0
    server.use(http.get(`${API}/users/:id/avatar`, () => { photoRequests += 1; return new HttpResponse(null, { status: 404 }) }))
    renderWithProviders(<UserAvatar userId="u1" name="Ada Lovelace" label="Ada Lovelace" />)
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toHaveTextContent('AL')
    await new Promise((r) => setTimeout(r, 30))
    expect(photoRequests).toBe(0)
    expect(colourFor('u1')).toBe(colourFor('u1'))
    expect(initials('Cher')).toBe('C')
    expect(initials('')).toBe('?')
  })

  test('initials always fit their circle: one letter below 24px, text well under the diameter', () => {
    expect(initialsFor('Ada Lovelace', 20)).toBe('A')
    expect(initialsFor('Ada Lovelace', 24)).toBe('AL')
    expect(initials('Mary Jane Watson')).toBe('MW')
    for (const size of [20, 24, 28, 36, 56]) {
      const style = initialsStyle(size)
      expect(style.lineHeight).toBe(1)
      // Two wide capitals ("MW") are roughly 1.7em across; they must clear a 2px ring on each side.
      expect(style.fontSize * 1.7).toBeLessThanOrEqual(size - 4)
    }
  })

  test('fetches the photo once per user and version and shows it', async () => {
    photoIndex({ u1: '1700' })
    const seen = []
    server.use(http.get(`${API}/users/:id/avatar`, ({ request, params }) => {
      seen.push(`${params.id}?${new URL(request.url).searchParams.get('v')}`)
      return pngResponse()
    }))
    renderWithProviders(
      <>
        <UserAvatar userId="u1" name="Ada Lovelace" label="Ada one" />
        <UserAvatar userId="u1" name="Ada Lovelace" label="Ada two" />
      </>,
    )
    await waitFor(() => expect(screen.getByRole('img', { name: 'Ada one' }).querySelector('img'))
      .toHaveAttribute('src', expect.stringMatching(/^blob:/)))
    expect(seen).toEqual(['u1?1700'])
  })
})

describe('AvatarStack', () => {
  const people = ['Ann A', 'Ben B', 'Cy C', 'Di D', 'Ed E', 'Flo F'].map((name, i) => ({ id: `p${i}`, name }))

  test('shows a few circles and a +N with everyone else named', () => {
    renderWithProviders(<AvatarStack people={people} max={4} label="Team" />)
    const group = screen.getByRole('group', { name: 'Team' })
    expect(within(group).getByRole('img', { name: 'Ann A' })).toBeInTheDocument()
    expect(within(group).getByRole('img', { name: '3 more: Di D, Ed E, Flo F' })).toHaveTextContent('+3')
  })

  test('the +N circle is the same size as the others', () => {
    renderWithProviders(<AvatarStack people={people} max={3} size={28} label="Team" />)
    const more = screen.getByRole('img', { name: /4 more/ })
    expect(more).toHaveStyle({ width: '28px', height: '28px' })
    expect(screen.getByRole('img', { name: 'Ann A' })).toHaveStyle({ width: '28px', height: '28px' })
  })

  test('labels include the detail, and nothing renders for nobody', () => {
    const { container } = renderWithProviders(<AvatarStack people={[]} />)
    expect(container.querySelector('.MuiAvatarGroup-root')).toBeNull()
    renderWithProviders(<AvatarStack people={[{ id: 'x', name: 'Ann A', detail: 'Primary', highlight: true }]} />)
    expect(screen.getByRole('img', { name: 'Ann A · Primary' })).toBeInTheDocument()
  })
})

describe('AvatarDialog', () => {
  const renderDialog = (onClose = () => {}) =>
    renderWithProviders(<AvatarDialog open user={users.employee} onClose={onClose} />)

  test('a chosen photo is previewed, then uploaded as base64 PNG', async () => {
    let body
    server.use(http.put(`${API}/me/avatar`, async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ ...users.employee, avatar_url: '/users/u-emp/avatar?v=1' })
    }))
    const onClose = vi.fn()
    renderDialog(onClose)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.upload(screen.getByTestId('avatar-file'), file('image/jpeg'))
    expect(await screen.findByRole('img', { name: /preview of your new photo/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(body).toEqual({ image: 'iVBORw0KGgo=' })
  })

  test('the server explaining why it refused the image is shown', async () => {
    server.use(http.put(`${API}/me/avatar`, () => HttpResponse.json({ error: { code: 'VALIDATION_ERROR',
      message: 'That image has extra data hidden after it, so it was refused.', details: { image: 'trailing_data' },
      request_id: 'r-9' } }, { status: 400 })))
    renderDialog()
    await userEvent.upload(screen.getByTestId('avatar-file'), file('image/png'))
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/extra data hidden after it/i)
  })

  test('an SVG or other unsupported file is refused before anything is sent', async () => {
    renderDialog()
    await userEvent.upload(screen.getByTestId('avatar-file'), file('image/svg+xml'), { applyAccept: false })
    expect(await screen.findByRole('alert')).toHaveTextContent(/png, jpeg or webp/i)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('someone with a photo can remove it', async () => {
    photoIndex({ 'u-emp': '5' })
    server.use(
      http.get(`${API}/users/:id/avatar`, pngResponse),
      http.delete(`${API}/me/avatar`, () => HttpResponse.json({ ...users.employee, avatar_url: null })),
    )
    const onClose = vi.fn()
    renderDialog(onClose)
    await userEvent.click(await screen.findByRole('button', { name: /remove photo/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
