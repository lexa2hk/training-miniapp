#!/bin/bash
# Двойной клик по этому файлу запускает Журнал тренировок локально
# и открывает его в браузере. Окно Терминала не закрывай, пока пользуешься.
cd "$(dirname "$0")"
PORT=8777

# если порт занят (сервер уже запущен) — просто откроем браузер
if lsof -i ":$PORT" >/dev/null 2>&1; then
  echo "Сервер уже работает на порту $PORT"
else
  echo "Запускаю сервер на http://localhost:$PORT ..."
  python3 -m http.server "$PORT" >/tmp/zhurnal_trenirovok.log 2>&1 &
  sleep 1
fi

open "http://localhost:$PORT"
echo ""
echo "Приложение открыто: http://localhost:$PORT"
echo "Чтобы остановить — закрой это окно Терминала или нажми Ctrl+C."
echo ""
# держим окно открытым, пока работает сервер
wait
