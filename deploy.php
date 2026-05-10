<?php
$secret = getenv('DEPLOY_SECRET');
$payload = file_get_contents('php://input');
$sig = 'sha256=' . hash_hmac('sha256', $payload, $secret);

if (!hash_equals($sig, $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '')) {
    http_response_code(403); exit('Forbidden');
}

$repo = '/home3/sevireco/public_html/gardenai';
chdir($repo);

exec('git fetch origin main 2>&1', $fetch, $r1);
exec('git reset --hard origin/main 2>&1', $reset, $r2);
exec('/usr/local/cpanel/bin/uapi --user=sevireco VersionControlDeployment create repository_root=' . escapeshellarg($repo) . ' 2>&1', $deploy, $r3);

echo json_encode([
    'fetch' => $fetch,
    'reset' => $reset,
    'deploy' => $deploy,
    'status' => ($r1 === 0 && $r2 === 0) ? 'ok' : 'error'
]);
