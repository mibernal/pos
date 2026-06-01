-- Lua script para rate-limit atómico
-- KEYS[1] = clave del contador (e.g. "ratelimit:{ip}:{email}")
-- ARGV[1] = ventana en segundos (TTL)
-- ARGV[2] = límite máximo de intentos
-- Retorna: número actual de intentos tras incrementar
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
