import { render } from 'preact';
import type { GameMode } from '@avi/sim';

const MODES: { mode: GameMode; title: string; description: string }[] = [
  { mode: 'peaceful', title: 'Без НЛО', description: 'Мирный город. Планируй кварталы, создавай рабочие места и следи за довольством.' },
  { mode: 'ufo', title: 'С НЛО', description: 'Выход из бункера. Развивай город, исследуй технологии и защищай жителей.' },
];

export interface ModeChoice {
  mode: GameMode;
  /** true - начать с чистой карты, false - загрузить существующее сохранение. */
  newGame: boolean;
}

export function pickMode(hasSave: (mode: GameMode) => boolean, starting: boolean): Promise<ModeChoice | null> {
  const dialog = document.createElement('dialog');
  dialog.className = 'mode-picker';
  dialog.setAttribute('aria-labelledby', 'mode-title');
  document.body.append(dialog);
  return new Promise((resolve) => {
    let replacement: (typeof MODES)[number] | null = null;
    const finish = (choice: ModeChoice | null) => {
      dialog.close();
      render(null, dialog);
      dialog.remove();
      resolve(choice);
    };
    const back = () => {
      const mode = replacement?.mode;
      replacement = null;
      renderPicker();
      dialog.querySelector<HTMLButtonElement>(`.mode-option.${mode} button`)?.focus();
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (replacement) back();
      else if (!starting) finish(null);
    });
    const confirmNew = (option: (typeof MODES)[number]) => {
      replacement = option;
      renderPicker();
      dialog.querySelector<HTMLButtonElement>('.mode-back')?.focus();
    };
    const renderPicker = () => {
      const selected = replacement;
      render(
        <>
          <div class="mode-brand">Avi Town</div>
          <h1 id="mode-title">
            {selected ? `Начать новый город в режиме "${selected.title}"?` : starting ? 'Выбери режим и город' : 'Новая игра'}
          </h1>
          {selected ? (
            <>
              <p>{hasSave(selected.mode)
                ? 'Текущий город этого режима будет сохранён в резервной копии. Новый город начнётся с первого дня.'
                : 'Будет создан новый город с первого дня.'}</p>
              <button class="mode-back" onClick={back}>Назад</button>{' '}
              <button onClick={() => finish({ mode: selected.mode, newGame: true })}>Начать новый город</button>
            </>
          ) : (
            <>
              <div class="mode-options">
                {MODES.map((option) => {
                  const { mode, title, description } = option;
                  const saved = hasSave(mode);
                  return (
                    <div key={mode} class={`mode-option ${mode}`}>
                      <strong>{title}</strong>
                      <span>{description}</span>
                      {starting && saved ? (
                        <div class="mode-option-actions">
                          <button onClick={() => finish({ mode, newGame: false })}>Продолжить город</button>
                          <button onClick={() => confirmNew(option)}>Новый город</button>
                        </div>
                      ) : (
                        <button onClick={() => {
                          if (starting) finish({ mode, newGame: true });
                          else confirmNew(option);
                        }}>Начать новый город</button>
                      )}
                    </div>
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
