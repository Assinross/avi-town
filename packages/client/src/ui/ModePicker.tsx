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
    const finish = (mode: GameMode | null) => {
      dialog.close();
      render(null, dialog);
      dialog.remove();
      resolve(mode);
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!starting) finish(null);
    });
    render(
      <>
        <div class="mode-brand">Avi Town</div>
        <h1 id="mode-title">{starting ? 'Выбери режим' : 'Новая игра'}</h1>
        <div class="mode-options">
          {MODES.map(({ mode, title, description }) => (
            <button key={mode} class={mode} onClick={() => finish(mode)}>
              <strong>{title}</strong>
              <span>{description}</span>
              <small>{starting && hasSave(mode) ? 'Продолжить город' : 'Начать новый город'}</small>
            </button>
          ))}
        </div>
        {!starting && (
          <>
            <p>Предыдущий город выбранного режима сохранится в резервной копии.</p>
            <button onClick={() => finish(null)}>Отмена</button>
          </>
        )}
      </>,
      dialog,
    );
    dialog.showModal();
  });
}
