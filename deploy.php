<?php
$token = $_GET['token'] ?? '';
if (!hash_equals('GardenDeploy2026!', $token)) {
    http_response_code(403); exit('Forbidden');
}

$repo = '/home3/sevireco/public_html/gardenai';
chdir($repo);

exec('git fetch origin main 2>&1', $fetch);
exec('git reset --hard origin/main 2>&1', $reset);

echo json_encode(['fetch' => $fetch, 'reset' => $reset, 'status' => 'ok']);
