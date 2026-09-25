#!/usr/bin/env node
/*
 * 编译 LX Focus 原生辅助进程。
 *
 * 优先使用 Windows 自带的 .NET Framework 编译器（csc.exe），
 * 这样用户不需要安装任何开发工具链；找不到时退回 dotnet CLI。
 *
 * 用法：node scripts/build-native-guard.mjs
 */

import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const sourceFile = path.join(projectRoot, 'native', 'LxFocusGuard.cs')
const outputDir = path.join(projectRoot, 'native', 'bin')
const outputFile = path.join(outputDir, 'LxFocusGuard.exe')

if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

if (process.platform !== 'win32') {
  // 非 Windows 上跳过编译，但要把 native/bin 造出来并放个说明文件：
  // 打包配置里的 extraResources 指向这个目录，目录缺失会让打包直接报错。
  const { writeFileSync } = await import('node:fs')
  writeFileSync(
    path.join(outputDir, 'README.txt'),
    '非 Windows 平台不构建原生辅助进程。\n' +
      'Win 键 / Alt+Tab 拦截依赖 Windows 的 WH_KEYBOARD_LL 钩子，仅在 Windows 上生效。\n',
    'utf-8'
  )
  console.log('[native-guard] 当前非 Windows 平台，已跳过编译（Win 键拦截仅 Windows 可用）。')
  process.exit(0)
}

if (!existsSync(sourceFile)) {
  console.error(`[native-guard] 找不到源文件：${sourceFile}`)
  process.exit(1)
}

const windir = process.env.WINDIR ?? 'C:\\Windows'
const frameworkCandidates = [
  path.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
]

const csc = frameworkCandidates.find(candidate => existsSync(candidate))

if (csc) {
  console.log(`[native-guard] 使用编译器：${csc}`)
  const result = spawnSync(
    csc,
    [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      '/optimize+',
      '/warn:0',
      `/out:${outputFile}`,
      sourceFile,
    ],
    { stdio: 'inherit' }
  )
  if (result.error) {
    console.error('[native-guard] 调用 csc.exe 失败：', result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[native-guard] 编译失败，退出码 ${result.status}`)
    process.exit(result.status ?? 1)
  }
} else {
  const dotnet = spawnSync('dotnet', ['--version'], { stdio: 'ignore' })
  if (dotnet.status !== 0) {
    console.error('[native-guard] 既没有找到 csc.exe，也没有可用的 dotnet CLI。')
    console.error('[native-guard] 请安装 .NET SDK 后重试，或手动编译 native/LxFocusGuard.cs。')
    process.exit(1)
  }
  console.log('[native-guard] 未找到 csc.exe，改用 dotnet 编译临时工程')
  const tempProject = path.join(projectRoot, 'native', 'guard-build')
  if (!existsSync(tempProject)) mkdirSync(tempProject, { recursive: true })
  const csproj = path.join(tempProject, 'LxFocusGuard.csproj')
  const builder = [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '  <PropertyGroup>',
    '    <OutputType>Exe</OutputType>',
    '    <TargetFramework>net8.0-windows</TargetFramework>',
    '    <Nullable>disable</Nullable>',
    '    <AllowUnsafeBlocks>false</AllowUnsafeBlocks>',
    '    <AssemblyName>LxFocusGuard</AssemblyName>',
    '    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>',
    '  </PropertyGroup>',
    '  <ItemGroup>',
    `    <Compile Include="${sourceFile.replace(/\\/g, '/')}" />`,
    '  </ItemGroup>',
    '</Project>',
  ].join('\n')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(csproj, builder, 'utf-8')

  const result = spawnSync('dotnet', ['publish', csproj, '-c', 'Release', '-o', outputDir], {
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error('[native-guard] dotnet 编译失败')
    process.exit(result.status ?? 1)
  }
}

console.log(`[native-guard] 编译完成：${outputFile}`)
