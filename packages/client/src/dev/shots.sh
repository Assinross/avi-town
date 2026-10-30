#!/usr/bin/env bash
# Снимки "до/после" для плана 010: сцена-витрина (?showcase) или эталонный город (?bench)
# с четырёх точек камеры - обзор, улица, двор, перекрёсток.
#
# Запуск (dev-сервер должен быть поднят):
#   bash packages/client/src/dev/shots.sh 0-before            # витрина, снимки 0-before-0..3.png
#   bash packages/client/src/dev/shots.sh 1-before showcase
#   bash packages/client/src/dev/shots.sh 1-before bench      # эталонный город benchCity
#   bash packages/client/src/dev/shots.sh 0-before showcase http://localhost:5173
#
# Снимки ложатся в specs/010-cityrt-world/shots/<префикс>-<N>.png, где N - номер точки камеры:
#   витрина: 0 - обзор, 1 - улица, 2 - двор, 3 - перекрёсток (SHOTS в src/dev/showcase.ts);
#   bench:   0 - общий план, 1 - жильё, 2 - торговля, 3 - край карты (SHOTS в src/dev/benchCity.ts)
set -euo pipefail

prefix=${1:?Укажи префикс снимков, например 0-before}
mode=${2:-showcase}
# Порт dev-сервера - как в .claude/launch.json
base=${3:-http://localhost:5174}

cd "$(dirname "$0")/../../../.."
out=specs/010-cityrt-world/shots
mkdir -p "$out"

# Своя сессия браузера: чтобы не мешать другим окнам agent-browser;
# без песочницы (Ubuntu 26.04) и с окном - в фоне страница не рисует кадры
ab() { agent-browser --session avi-shots --args "--no-sandbox" --headed "$@"; }
# Интерфейс и подписи в снимок не берём - сравниваем только картинку города
hide_ui() { ab eval "document.getElementById('ui').style.display='none';document.getElementById('labels').style.display='none';'ok'" >/dev/null; }

# Страница сама строит сцену и перезагружается на неё, затем остаётся на ?town=showcase (витрина)
ab open "$base/?$mode"
ab set viewport 1600 900
sleep 10
if [ "$mode" = showcase ]; then page='?town=showcase&hour=13'; else page='?hour=13'; fi

for n in 0 1 2 3; do
  # ?shot=N - камера в точку N; перезагрузка берёт уже сохранённую сцену
  ab eval "location.search='$page&shot=$n'" >/dev/null
  sleep 6
  hide_ui
  ab screenshot "$out/$prefix-$n.png"
  echo "снимок: $out/$prefix-$n.png"
done

ab close
