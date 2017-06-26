'use strict'
const ts = require('typescript')
const fs = require('fs')
const appRootPath = require('app-root-path')
const os = require('os')
const path = require('path')
const process = require('process')
const TSCONFIG_PATH = process.env.TSCONFIG_PATH
var upstreamTransformer = null
try {
  upstreamTransformer = require('metro-bundler/src/transformer')
} catch (e) {
  upstreamTransformer = {
    transform: function(ref) {
      return require('react-native/packager/transformer').transform(
        ref.src,
        ref.filename,
        ref.options
      )
    },
  }
}

const { SourceMapConsumer, SourceMapGenerator } = require('source-map')

function loadJsonFile(jsonFilename) {
  if (!fs.existsSync(jsonFilename)) {
    throw new Error(`Input file not found: ${jsonFilename}`)
  }

  const buffer = fs.readFileSync(jsonFilename)
  try {
    let jju = require('jju')
    return jju.parse(buffer.toString())
  } catch (error) {
    throw new Error(
      `Error reading "${jsonFilename}":${os.EOL}  ${error.message}`
    )
  }
}

function composeRawSourceMap(tsMap, babelMap) {
  const tsConsumer = new SourceMapConsumer(tsMap)
  const composedMap = []
  babelMap.forEach(
    ([generatedLine, generatedColumn, originalLine, originalColumn, name]) => {
      if (originalLine) {
        const tsOriginal = tsConsumer.originalPositionFor({
          line: originalLine,
          column: originalColumn,
        })
        if (tsOriginal.line) {
          if (typeof name === 'string') {
            composedMap.push([
              generatedLine,
              generatedColumn,
              tsOriginal.line,
              tsOriginal.column,
              name,
            ])
          } else {
            composedMap.push([
              generatedLine,
              generatedColumn,
              tsOriginal.line,
              tsOriginal.column,
            ])
          }
        }
      }
    }
  )
  return composedMap
}

function composeSourceMaps(tsMap, babelMap, tsFileName, tsContent, babelCode) {
  const tsConsumer = new SourceMapConsumer(tsMap)
  const babelConsumer = new SourceMapConsumer(babelMap)
  const map = new SourceMapGenerator()
  map.setSourceContent(tsFileName, tsContent)
  babelConsumer.eachMapping(
    ({
      source,
      generatedLine,
      generatedColumn,
      originalLine,
      originalColumn,
      name,
    }) => {
      if (originalLine) {
        const original = tsConsumer.originalPositionFor({
          line: originalLine,
          column: originalColumn,
        })
        if (original.line) {
          map.addMapping({
            generated: { line: generatedLine, column: generatedColumn },
            original: { line: original.line, column: original.column },
            source: tsFileName,
            name: name,
          })
        }
      }
    }
  )
  return map.toJSON()
}

const tsConfig = (() => {
  if (TSCONFIG_PATH) {
    const resolvedTsconfigPath = path.resolve(process.cwd(), TSCONFIG_PATH)
    if (fs.existsSync(resolvedTsconfigPath)) {
      return loadJsonFile(resolvedTsconfigPath)
    }
    console.warn(
      'tsconfig file specified by TSCONFIG_PATH environment variable was not found'
    )
    console.warn(`TSCONFIG_PATH = ${TSCONFIG_PATH}`)
    console.warn(`resolved = ${resolvedTsconfigPath}`)
    console.warn('looking in app root directory')
  }
  const tsConfigPath = appRootPath.resolve('tsconfig.json')
  if (fs.existsSync(tsConfigPath)) {
    return loadJsonFile(tsConfigPath)
  }
  throw new Error(`Unable to find tsconfig.json at ${tsConfigPath}`)
})()

const compilerOptions = Object.assign(tsConfig.compilerOptions, {
  sourceMap: true,
  inlineSources: true,
})

module.exports.transform = function(sourceCode, fileName, options) {
  if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) {
    const tsCompileResult = ts.transpileModule(sourceCode, {
      compilerOptions,
      fileName,
      reportDiagnostics: true,
    })

    const errors = tsCompileResult.diagnostics.filter(
      ({ category }) => category === ts.DiagnosticCategory.Error
    )

    if (errors.length) {
      // report first error
      const error = errors[0]
      const message = ts.flattenDiagnosticMessageText(error.messageText, '\n')
      if (error.file) {
        let { line, character } = error.file.getLineAndCharacterOfPosition(
          error.start
        )
        throw new Error(
          `${error.file.fileName} (${line + 1},${character + 1}): ${message}`
        )
      } else {
        throw new Error(message)
      }
    }

    const babelCompileResult = upstreamTransformer.transform({
      src: tsCompileResult.outputText,
      filename: fileName,
      options,
    })

    const composedMap = Array.isArray(babelCompileResult.map)
      ? composeRawSourceMap(
          tsCompileResult.sourceMapText,
          babelCompileResult.map
        )
      : composeSourceMaps(
          tsCompileResult.sourceMapText,
          babelCompileResult.map,
          fileName,
          sourceCode,
          babelCompileResult.code
        )

    return Object.assign({}, babelCompileResult, {
      map: composedMap,
    })
  } else {
    return upstreamTransformer.transform({
      src: sourceCode,
      filename: fileName,
      options,
    })
  }
}
