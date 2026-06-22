# Журнал тренировок — Telegram Mini App

Мини-приложение для Telegram, построенное на основе твоего файла `Журнал_тренировок.xlsx`.
Позволяет вести лог подходов, смотреть прогресс, объём и личные рекорды — прямо внутри Telegram.

Вся твоя история из Excel (107 подходов, март–июнь 2025) уже зашита в приложение
и подгружается при первом запуске.

## Что умеет

- **📋 Журнал** — быстрый ввод подхода (дата, тренировка, упражнение, вес, повторы, заметка).
  Объём (`вес × повторы`) и расчётный 1ПМ (формула Эпли `вес × (1 + повторы/30)`) считаются сами.
  Номер подхода проставляется автоматически, рекорды отмечаются 🏆. Любой подход можно удалить.
- **📈 Прогресс** — график расчётного 1ПМ по датам для выбранного упражнения + таблица по тренировкам
  и изменение в % с первой тренировки.
- **📊 Объём** — тоннаж/подходы/тренировки по месяцам (столбчатый график + таблица).
- **🏆 Сводка** — общая статистика и личные рекорды по всем упражнениям.
- **⚙️ Ещё** — экспорт/импорт данных (JSON), сброс к исходному журналу, очистка.

## Где хранятся данные

- В Telegram (версия 6.9+) — в **Telegram CloudStorage**: данные синхронизируются между всеми
  твоими устройствами с Telegram и переживают переустановку. Сервер/база данных не нужны.
- В обычном браузере или старом клиенте — в `localStorage` этого устройства (фолбэк для теста).

Состояние хранилища видно во вкладке «Ещё».

## Файлы проекта

| Файл | Назначение |
|------|------------|
| `index.html` | каркас приложения, подключает Telegram SDK |
| `styles.css` | стили (используют тему Telegram — светлую/тёмную) |
| `store.js` | слой хранения: CloudStorage с чанкингом + фолбэк на localStorage + первичный сид |
| `app.js` | вся логика и экраны, графики на SVG (без внешних библиотек) |
| `seed.js` | твоя история из Excel (загружается при первом запуске) |
| `seed.json` | те же данные в читаемом виде (источник для `seed.js`) |

Приложение полностью статическое — **сборка не нужна**, только раздать файлы по HTTPS.

## Локальный запуск

```bash
cd training-miniapp
python3 -m http.server 8777
# открой http://localhost:8777
```

В браузере оно работает с localStorage. Полноценный режим (CloudStorage, тема, хаптика) —
только внутри Telegram.

## Публикация и подключение к Telegram

Telegram Mini App — это веб-страница по HTTPS, привязанная к боту. Шаги:

### 1. Захостить файлы (любой статический хостинг по HTTPS)

Самое простое — **GitHub Pages**:

```bash
cd training-miniapp
git init && git add . && git commit -m "Журнал тренировок mini app"
# создай пустой репозиторий на GitHub, затем:
git remote add origin https://github.com/<твой-логин>/training-miniapp.git
git push -u origin main
```
В настройках репозитория → **Settings → Pages** → Source: `main` / `/ (root)` → Save.
Через минуту приложение будет по адресу `https://<твой-логин>.github.io/training-miniapp/`.

Альтернативы без git: перетащить папку на [netlify.com/drop](https://app.netlify.com/drop)
или задеплоить через `vercel`. Подойдёт любой HTTPS-хостинг статики.

### 2. Создать бота и привязать приложение через @BotFather

1. Открой [@BotFather](https://t.me/BotFather) в Telegram.
2. `/newbot` → задай имя и username бота → получишь токен (просто сохрани, он понадобится только если захочешь сервер).
3. `/newapp` → выбери своего бота → заполни название, описание, картинку (640×360) и иконку (240×240) → **Web App URL**: вставь адрес из шага 1 (`https://.../training-miniapp/`).
4. (Удобно) `/mybots` → выбери бота → **Bot Settings → Menu Button → Configure menu button** → вставь тот же URL и подпись кнопки, напр. «Открыть журнал».

Готово: открываешь бота в Telegram, жмёшь кнопку меню — приложение запускается, история на месте.

> Ссылку на приложение можно также получить у BotFather после `/newapp` в виде `t.me/<bot>/<appname>`.

## Как обновить «зашитые» данные из Excel

Если изменишь Excel и захочешь пересобрать стартовый сид:

```bash
python3 - <<'PY'
import openpyxl, json, datetime
wb = openpyxl.load_workbook("Журнал_тренировок.xlsx", data_only=True)
ws = wb["Лог"]; sets=[]
for r in ws.iter_rows(min_row=5, values_only=True):
    d,w,e,n,wt,rp,_,_,nt = (list(r)+[None]*9)[:9]
    if e is None or wt is None or rp is None: continue
    d = d.strftime("%Y-%m-%d") if isinstance(d,(datetime.date,datetime.datetime)) else str(d)
    sets.append({"date":d,"workout":(w or ""),"exercise":e,"setNo":int(n or 1),
                 "weight":float(wt),"reps":int(rp),"notes":(nt or "")})
ref=wb["Справочники"]; wks=[];exs=[]
for r in ref.iter_rows(min_row=4, values_only=True):
    a,_,c=(list(r)+[None]*3)[:3]
    if isinstance(a,str) and a.strip(): wks.append(a.strip())
    if isinstance(c,str) and c.strip(): exs.append(c.strip())
seed={"sets":sets,"workouts":wks,"exercises":exs}
json.dump(seed,open("seed.json","w"),ensure_ascii=False,separators=(",",":"))
open("seed.js","w").write("window.__WT_SEED__ = "+json.dumps(seed,ensure_ascii=False,separators=(",",":"))+";\n")
print("обновлено:", len(sets), "подходов")
PY
```

После этого во вкладке «Ещё» нажми «Перезагрузить из журнала», чтобы подтянуть свежий сид.
