#!/usr/bin/env python3
"""Manual, offline vendor preparation. Never called by install/build/deploy.

Quiet Journal contributors, 2026, MIT (see ../LICENSE).
Derived Waline files keep their upstream GPL-2.0 license; this script is not
permission to relicense them. Inputs must be downloaded and reviewed separately.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

PROFILE = 'postgres-no-external-v1'
SERVER_COMMIT = 'c4b0f1ebb9a7970d36493d4c3580f3f43e098fa5'
ADMIN_COMMIT = 'c0a8f7c0ecf6dc24fab02845b1195753bdec0997'
SERVER_NPM = 'g6qblq8i5H0ByDbsYRdPcsvauXicXfiLYhxIynwHpuYuawM1QuxAGkttQQgCOi+u960JFjbsQOmRzA0XHJfydw=='
SERVER_SOURCE_SHA = 'd1fa1b7d385d0d13c1fd4ad2956bea281182fea36f3c516285187a1cdbe77cb2'
ADMIN_SOURCE_SHA = '31214be677da9bd49f5960aa4b9cde1ea44a449b94be4e6e0a9b4955951ab4e1'
ADMIN_JS_SHA = '1ec61f7b6bad65cb52ad803914754b54f967c382680d0c0083e39fd6811718c6'
ADMIN_MAP_SHA = 'df2f0eadad2e121a6d54b316a3724bcb65a81087fc630ca0ed0bc8e43e52748e'
LICENSE_SHA = '010728bac3f86aa3c028f766a28f4ec2da4289335571dc9756e5a7d595de59bc'
ROOT_BUILD = {'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'LICENSE', 'README.md', 'tsconfig.json', 'tsconfig.base.json'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def archive(path, digest, prefix, select=lambda name: True, algorithm='sha256'):
    data = Path(path).read_bytes()
    actual = hashlib.new(algorithm, data).digest()
    expected = base64.b64decode(digest) if algorithm == 'sha512' else bytes.fromhex(digest)
    if actual != expected:
        raise ValueError('Upstream archive integrity mismatch: ' + Path(path).name)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        members = tar.getmembers()
        if sum(m.size for m in members) > 150 * 1024 * 1024:
            raise ValueError('Unexpected upstream archive size')
        for member in members:
            if not (member.isdir() or member.isfile()) or '..' in PurePosixPath(member.name).parts:
                raise ValueError('Unexpected upstream archive member')
            if member.isdir():
                continue
            if not member.name.startswith(prefix):
                raise ValueError('Unexpected archive root')
            name = member.name[len(prefix):]
            if select(name):
                if name in files:
                    raise ValueError('Duplicate archive member')
                files[name] = tar.extractfile(member).read()
    return files


def pack(files):
    output = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w', format=tarfile.USTAR_FORMAT) as tar:
            for name, data in sorted(files.items()):
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = 0o644
                member.mtime = 0
                tar.addfile(member, io.BytesIO(data))
    return output.getvalue()


def prepare(args):
    output = Path(args.output)
    if output.exists():
        raise ValueError('Output must be a new directory; existing vendor files are never overwritten')
    files = archive(args.server_npm, SERVER_NPM, 'package/', algorithm='sha512')
    original = {p: sha(data) for p, data in files.items()}
    if sha(files['LICENSE']) != LICENSE_SHA:
        raise ValueError('Unexpected upstream license')
    removed = ['src/service/storage/cloudbase.js', 'src/service/storage/leancloud.js']
    for name in removed:
        del files[name]
    files['src/service/akismet.js'] = b"""// Quiet Journal profile, modified 2026-10-16. Upstream license: see LICENSE.
// This deployment uses moderation, never third-party spam submission.
module.exports = class extends think.Service {
  constructor(blog) {
    super(blog);
    if (process.env.AKISMET_KEY !== 'false') throw new Error('This profile does not include Akismet.');
  }
  async check() { return false; }
};
"""
    # Waline serializes the result even with disableUserAgent, so retain its
    # empty result shape without parsing HTTP headers or installing AGPL code.
    files['src/service/disabled-user-agent.js'] = b"""// Quiet Journal profile, added 2026-10-16. Upstream license: see LICENSE.
// Explicit disabled-feature adapter, not a parser fallback.
module.exports = function disabledUserAgent() {
  if (process.env.DISABLE_USERAGENT !== 'true') throw new Error('User-Agent parsing is not available in this profile.');
  return { browser: {}, cpu: {}, device: {}, engine: {}, os: {} };
};
"""
    for name, dependency in [('src/service/core.js', './disabled-user-agent.js'), ('src/extend/think.js', '../service/disabled-user-agent.js')]:
        old = "const parser = require('ua-parser-js');"
        text = files[name].decode()
        if text.count(old) != 1:
            raise ValueError('Upstream parser import contract changed')
        files[name] = text.replace(old, f"// Quiet Journal profile, modified 2026-10-16: device parsing is disabled.\nconst parser = require('{dependency}');").encode()
    package = json.loads(files['package.json'])
    dependencies = ['@cloudbase/node-sdk', 'leancloud-storage', 'akismet', 'ua-parser-js']
    for name in dependencies:
        del package['dependencies'][name]
    package['license'] = 'SEE LICENSE IN LICENSE'
    package['quietJournalProfile'] = PROFILE
    files['package.json'] = encoded(package)
    profile = {
        'profile': PROFILE, 'modified': '2026-10-16',
        'upstream': {'name': '@waline/vercel', 'version': '1.43.4', 'integrity': 'sha512-' + SERVER_NPM, 'commit': SERVER_COMMIT},
        'removedFiles': removed, 'removedDependencies': dependencies,
        'modifiedFiles': ['package.json', 'src/service/akismet.js', 'src/service/core.js', 'src/extend/think.js'],
        'addedFiles': ['src/service/disabled-user-agent.js'], 'originalFiles': original,
    }
    files['QJ-PROFILE.json'] = encoded(profile)
    server_package = pack({'package/' + name: data for name, data in files.items()})

    server_source = archive(args.server_source, SERVER_SOURCE_SHA, 'waline-' + SERVER_COMMIT + '/',
                            lambda p: p.startswith('packages/core/') or p in ROOT_BUILD)
    source_files = {'waline-server-source/server/' + p: data for p, data in files.items()}
    source_files.update({'waline-server-source/upstream-build/' + p: data for p, data in server_source.items()})
    source_files['waline-server-source/prepare-vendor.py'] = Path(__file__).read_bytes()
    source_files['waline-server-source/README.txt'] = (
        'Waline server 1.43.4, Quiet Journal profile. GPL-2.0; see server/LICENSE.\n'
        'The server/ directory is the exact patched npm package source, including its bundled core output.\n'
        f'Preferred TypeScript core sources and original build inputs are from {SERVER_COMMIT}.\n'
        'QJ-PROFILE.json lists every change; controllers, authentication, moderation and SQL storage are not rewritten.\n'
        'prepare-vendor.py reproduces the profile from separately obtained, hash-pinned upstream inputs.\n'
        'Runtime dependencies retain their own licenses. This is not a redistributable all-dependency server image.\n'
    ).encode()
    server_sources = pack(source_files)

    source = archive(args.admin_source, ADMIN_SOURCE_SHA, 'waline-' + ADMIN_COMMIT + '/',
                     lambda p: p.startswith('packages/admin/') or p in ROOT_BUILD)
    build = Path(args.admin_build).resolve()
    admin = (build / 'dist/admin.js').read_bytes()
    source_map = (build / 'dist/admin.js.map').read_bytes()
    if sha(admin) != ADMIN_JS_SHA or sha(source_map) != ADMIN_MAP_SHA:
        raise ValueError('Admin build is not the reviewed build; review and update hashes explicitly')
    for path, data in source.items():
        if path.startswith('packages/admin/src/') and (build / path[len('packages/admin/'):]).read_bytes() != data:
            raise ValueError('Admin application source was changed: ' + path)
    upstream_package = json.loads(source['packages/admin/package.json'])
    expected = dict(upstream_package)
    expected['scripts'] = {'build': 'NODE_ENV=production vite build'}
    expected['private'] = True
    expected['devDependencies'] = dict(upstream_package['devDependencies'])
    expected['devDependencies'].update({'@vitejs/plugin-react': '6.1.2', 'vite-plugin-css-injected-by-js': '5.0.2', 'vite-plugin-svgr': '5.2.0', '@babel/runtime': '8.0.0', 'vite': '8.2.4'})
    if json.loads((build / 'package.json').read_bytes()) != expected:
        raise ValueError('Admin build manifest was changed')
    config = source['packages/admin/vite.config.ts'].replace(b'  build: {\n', b"  build: {\n    sourcemap: 'hidden',\n")
    if (build / 'vite.config.ts').read_bytes() != config:
        raise ValueError('Admin build configuration was changed')
    if sha(source['LICENSE']) != LICENSE_SHA:
        raise ValueError('Unexpected admin license')
    admin_package_metadata = dict(upstream_package)
    admin_package_metadata.pop('devDependencies', None)
    admin_package_metadata.pop('scripts', None)
    admin_package_metadata['license'] = 'SEE LICENSE IN LICENSE'
    admin_package_metadata['quietJournalBuild'] = {'commit': ADMIN_COMMIT, 'sha256': ADMIN_JS_SHA}
    admin_package = pack({'package/package.json': encoded(admin_package_metadata), 'package/LICENSE': source['LICENSE'], 'package/dist/admin.js': admin})

    admin_sources = {'waline-admin-source/admin/' + p[len('packages/admin/'):]: data for p, data in source.items() if p.startswith('packages/admin/')}
    admin_sources.update({'waline-admin-source/upstream-build/' + p: data for p, data in source.items() if p in ROOT_BUILD})
    for name in ['package.json', 'package-lock.json', 'vite.config.ts']:
        admin_sources['waline-admin-source/admin/' + name] = (build / name).read_bytes()
    admin_sources['waline-admin-source/admin/dist/admin.js.map'] = source_map
    admin_sources['waline-admin-source/admin/LICENSE'] = source['LICENSE']
    mapping = json.loads(source_map)
    if not mapping['sourcesContent'] or not all(isinstance(s, str) for s in mapping['sourcesContent']):
        raise ValueError('Corresponding source map must contain all module sources')
    modules = set()
    for path in mapping['sources']:
        match = re.match(r'^\.\./node_modules/((?:@[^/]+/)?[^/]+)/', path)
        if match:
            modules.add(match[1])
    notices = []
    for name in sorted(modules):
        directory = build / 'node_modules' / name
        metadata = json.loads((directory / 'package.json').read_bytes())
        if metadata.get('license') not in {'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause'}:
            raise ValueError('Bundled module license needs review: ' + name)
        notices.append(f"{name}@{metadata['version']}: {metadata['license']}")
        for path in sorted(directory.rglob('*')):
            if path.is_symlink():
                raise ValueError('Unexpected symlink in bundled module')
            if path.is_file():
                relative = path.relative_to(directory).as_posix()
                if 'node_modules' not in PurePosixPath(relative).parts:
                    admin_sources['waline-admin-source/third-party/' + name + '/' + relative] = path.read_bytes()
    admin_sources['waline-admin-source/THIRD-PARTY.txt'] = ('Published sources, package metadata and licenses of bundled modules:\n' + '\n'.join(notices) + '\n').encode()
    admin_sources['waline-admin-source/README.txt'] = (
        f'Waline admin 0.36.0 application source: {ADMIN_COMMIT}. GPL-2.0; see admin/LICENSE and upstream-build/README.md.\n'
        'This is a disclosed rebuild, not the unmodified npm admin.js. Application source was not edited.\n'
        'Build changes: isolated npm manifest/lock, @vitejs/plugin-react 6.1.2, Vite 8.2.4, hidden source map.\n'
        'From admin/: npm ci --ignore-scripts --no-audit --no-fund; npm run build (Node 24).\n'
        f'Expected dist/admin.js SHA-256: {ADMIN_JS_SHA}\n'
        'No GitHub Actions, cloud account, release command or runtime source-map URL is needed.\n'
        'third-party/ preserves the published source and license files of every bundled npm module.\n'
        'The hidden map additionally contains the exact sources of all modules used in this output.\n'
    ).encode()
    admin_sources = pack(admin_sources)
    products = {
        'waline-vercel-1.43.4-qj.1.tgz': server_package,
        'waline-admin-0.36.0-qj.1.tgz': admin_package,
        'waline-server-source-1.43.4.tar.gz': server_sources,
        'waline-admin-source-0.36.0.tar.gz': admin_sources,
    }
    if any(len(data) > 4 * 1024 * 1024 for data in products.values()):
        raise ValueError('Vendor artifact exceeds the bounded download size')
    manifest = {'version': 1, 'profile': PROFILE, 'adminSha256': ADMIN_JS_SHA,
                'files': {name: {'bytes': len(data), 'sha256': sha(data)} for name, data in products.items()}}
    # All validation and archive construction precedes creating any output.
    output.mkdir(parents=True)
    for name, data in products.items():
        (output / name).write_bytes(data)
    (output / 'vendor-lock.json').write_bytes(encoded(manifest))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['server-npm', 'server-source', 'admin-source', 'admin-build', 'output']:
        parser.add_argument('--' + name, required=True)
    prepare(parser.parse_args())
