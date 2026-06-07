import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Render-only stub so this test doesn't pull in the signed-URL query layer.
vi.mock('@/ui/primitives/RecipeImage', () => ({
  RecipeImage: ({ path, alt }: { path: string | null; alt?: string }) => (
    <img data-testid="recipe-image" data-path={path ?? ''} alt={alt ?? ''} />
  ),
}));

vi.mock('@/lib/photo-resize', () => ({
  resizeForUpload: vi.fn(async (f: File) => f),
}));

const mocks = vi.hoisted(() => {
  const uploadMock = vi.fn();
  const removeMock = vi.fn();
  const getUserMock = vi.fn();
  const storageFromMock = vi.fn(() => ({ upload: uploadMock, remove: removeMock }));
  return { uploadMock, removeMock, getUserMock, storageFromMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.getUserMock },
    storage: { from: mocks.storageFromMock },
  },
}));

import { RecipeImageField } from './RecipeImageField';

function jpeg(name = 'photo.jpg', bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error('no file input rendered');
  return input as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mocks.uploadMock.mockResolvedValue({ data: { path: 'ok' }, error: null });
  mocks.removeMock.mockResolvedValue({ data: [{}], error: null });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('RecipeImageField', () => {
  it('shows the add-photo affordance when empty', () => {
    render(<RecipeImageField value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'recipe.photo_add' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'recipe.photo_remove' })).not.toBeInTheDocument();
  });

  it('shows a preview plus replace/remove when a value is set', () => {
    render(<RecipeImageField value="u1/hero.jpg" onChange={vi.fn()} />);
    expect(screen.getByTestId('recipe-image')).toHaveAttribute('data-path', 'u1/hero.jpg');
    expect(screen.getByRole('button', { name: 'recipe.photo_replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'recipe.photo_remove' })).toBeInTheDocument();
  });

  it('uploads a picked file to the user folder and reports the path', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(fileInput(), jpeg());

    expect(mocks.getUserMock).toHaveBeenCalled();
    expect(mocks.storageFromMock).toHaveBeenCalledWith('recipe-images');
    expect(mocks.uploadMock).toHaveBeenCalledTimes(1);
    const call = mocks.uploadMock.mock.calls[0];
    if (!call) throw new Error('upload not called');
    const [path, file, opts] = call;
    expect(path).toMatch(/^u1\/[0-9a-f-]+\.jpg$/);
    expect(file).toBeInstanceOf(File);
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(onChange).toHaveBeenCalledWith(path);
  });

  it('rejects a non-image type without uploading', async () => {
    const onChange = vi.fn();
    // applyAccept:false bypasses the input's accept filter so the guard runs
    // (a real browser can still deliver an off-type file via drag-drop).
    const user = userEvent.setup({ applyAccept: false });
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array(4)], 'note.gif', { type: 'image/gif' }),
    );

    expect(screen.getByText('errors.photo_wrong_type')).toBeInTheDocument();
    expect(mocks.uploadMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a file over the size limit without uploading', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    const big = jpeg('big.jpg', 1);
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    await user.upload(fileInput(), big);

    expect(screen.getByText('errors.photo_too_large')).toBeInTheDocument();
    expect(mocks.uploadMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('surfaces an error when the upload fails', async () => {
    mocks.uploadMock.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(fileInput(), jpeg());

    expect(screen.getByText('errors.photo_upload_failed')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the value when removed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value="u1/hero.jpg" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'recipe.photo_remove' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('frees a same-session upload when it is replaced', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<RecipeImageField value={null} onChange={onChange} />);

    await user.upload(fileInput(), jpeg('first.jpg'));
    const firstCall = onChange.mock.calls[0];
    if (!firstCall) throw new Error('onChange not called for first upload');
    const firstPath = firstCall[0] as string;
    onChange.mockClear();

    await user.upload(fileInput(), jpeg('second.jpg'));

    expect(mocks.removeMock).toHaveBeenCalledWith([firstPath]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
