import { render } from 'preact';
import type { GameMode } from '@avi/sim';

const MODES: { mode: GameMode; title: string; description: string }[] = [
  { mode: 'peaceful', title: 'Без НЛО', description: 'Мирный город. Планируй кварталы, создавай рабочие места и следи за довольством.' },
  { mode: 'ufo', title: 'С НЛО', description: 'Выход из бункера. Развивай город, исследуй технологии и защищай жителей.' },
];

export function pickMode(hasSave: (mode: GameMode) => boolean, starting: boolean): Promise<GameMode | null> {
  const dialog = document.createElement('dialog');
  dialog.className = 'mode-picker';
  dialog.setAttribute('aria-labelledby', 'mode-title');
  document.body.append(dialog);
  return new Promise((resolve) => {
    let replacement: (typeof MODES)[number] | null = null;
    const finish = (mode: GameMode | null) => {
      dialog.close();
      render(null, dialog);
      dialog.remove();
      resolve(mode);
    };
    const back = () => {
      const mode = replacement?.mode;
      replacement = null;
      renderPicker();
      dialog.querySelector<HTMLButtonElement>(`.mode-options .${mode}`)?.focus();
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (replacement) back();
      else if (!starting) finish(null);
    });
    const renderPicker = () => {
      const selected = replacement;
      render(
        <>
          <div class="mode-brand">Avi Town</div>
          <h1 id="mode-title">
            {selected ? `Начать новый город в режиме "${selected.title}"?` : starting ? 'Выбери режим' : 'Новая игра'}
          </h1>
          {selected ? (
            <>
              <p>Если у этого режима уже есть город, он сохранится в резервной копии.</p>
              <button class="mode-back" onClick={back}>Назад</button>{' '}
              <button onClick={() => finish(selected.mode)}>Начать новый город</button>
            </>
          ) : (
            <>
              <div class="mode-options">
                {MODES.map((option) => {
                  const { mode, title, description } = option;
                  const saved = hasSave(mode);
                  return (
                    <button key={mode} class={mode} onClick={() => {
                      if (starting) {
                        finish(mode);
                        return;
                      }
                      replacement = option;
                      renderPicker();
                      dialog.querySelector<HTMLButtonElement>('.mode-back')?.focus();
                    }}>
                      <strong>{title}</strong>
                      <span>{description}</span>
                      <small>{saved ? (starting ? 'Продолжить город' : 'Заменить текущий город') : 'Начать новый город'}</small>
                    </button>
                  );
                })}
              </div>
              {!starting && <button onClick={() => finish(null)}>Отмена</button>}
            </>
          )}
        </>,
        dialog,
      );
    };
    renderPicker();
    dialog.showModal();
  });
}
