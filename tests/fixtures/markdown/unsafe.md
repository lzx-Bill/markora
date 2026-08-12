# Unsafe input remains source only

<script>globalThis.markoraXss = true</script>

<img src="file:///private.txt" onerror="globalThis.markoraXss = true">

[unsafe](javascript:globalThis.markoraXss=true)

<a href="https://example.com" onclick="globalThis.markoraXss=true">safe destination</a>
