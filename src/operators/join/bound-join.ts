/* file : bound-join.ts
MIT License

Copyright (c) 2018 Thomas Minier

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

import { Observable, from } from 'rxjs'
import { bufferCount, map } from 'rxjs/operators'
import Graph from '../../rdf/graph'
import { Bindings } from '../../rdf/bindings'
import { Algebra } from 'sparqljs'
import { rdf } from '../../utils'

const BIND_JOIN_BUFFER_SIZE = 15

export type BGPBucket = Algebra.TripleObject[][]

export type RewritingTable = Map<number, Bindings>

/**
 * Rewrite a triple pattern using a rewriting key, i.e., append "_key" to each SPARQL variable in the triple pattern
 * @private
 * @param key - Rewriting key
 * @param tp - Triple pattern to rewrite
 * @return The rewritten triple pattern
 */
function rewriteTriple (triple: Algebra.TripleObject, key: number) {
  const res = Object.assign({}, triple)

  if (rdf.isVariable(triple.subject)) {
    res.subject = triple.subject + '_' + key
  }
  if (rdf.isVariable(triple.predicate)) {
    res.predicate = triple.predicate + '_' + key
  }
  if (rdf.isVariable(triple.object)) {
    res.object = triple.object + '_' + key
  }
  return res
}

/**
 * Find a rewriting key in a list of variables
 * For example, in [ ?s, ?o_1 ], the rewriting key is 1
 * @private
 */
function findKey (variables: IterableIterator<string>, maxValue = 15) {
  let key = -1
  for (let v of variables) {
    for (var i = 0; i < maxValue; i++) {
      if (v.endsWith('_' + i)) {
        return i
      }
    }
  }
  return key
}

/**
 * Undo the bound join rewriting on solutions bindings, e.g., rewrite all variables "?o_1" to "?o"
 * @private
 */
function revertBinding (key: number, input: Bindings, variables: IterableIterator<string>) {
  const newBinding = input.empty()
  for (let vName of variables) {
    if (vName.endsWith('_' + key)) {
      const index = vName.indexOf('_' + key)
      newBinding.set(vName.substring(0, index), input.get(vName)!)
    } else {
      newBinding.set(vName, input.get(vName)!)
    }
  }
  return newBinding
}

/**
 * Undo the rewriting on solutions bindings, and then merge each of them with the corresponding input binding
 * @private
 */
function rewriteSolutions (bindings: Bindings, rewritingMap: RewritingTable): Bindings {
  const key = findKey(bindings.variables())
  // rewrite binding, and then merge it with the corresponding one in the bucket
  let newBinding = revertBinding(key, bindings, bindings.variables())
  if (rewritingMap.has(key)) {
    newBinding = newBinding.union(rewritingMap.get(key)!)
  }
  return newBinding
}

/**
 * A special operator used to evaluate a UNION query with a Sage server,
 * and then rewrite bindings generated and performs union with original bindings.
 * @author Thomas Minier
 * @private
 * @param  {SageGraph} graph - Graph queried
 * @param  {TripleObject[][]} bgpBucket - List of BGPs to evaluate
 * @param  {Map<String, Binding>} rewritingTable - Map <rewriting key -> original bindings>
 * @param  {Object} options - Query execution option
 * @return {Observable<Binding>} An Observable which evaluates the query.
 */
function rewritingOp (graph: Graph, bgpBucket: BGPBucket, rewritingTable: RewritingTable, options: Object): Observable<Bindings> {
  return from(graph.evalUnion(bgpBucket, options))
    .pipe(map(bindings => {
      const x = rewriteSolutions(bindings, rewritingTable)
      return x
    }))
}

/**
 * Performs a Bound Join
 * @author Thomas Minier
 * @param  {Observable<Binding>} source - Source of bindings
 * @param  {TripleObject[]} bgp - Basic Pattern to join with
 * @param  {SageGraph} graph - Graphe queried
 * @param  {Object} options - Query execution options
 * @return {Observable<Binding>} An observable which evaluates the bound join
 */
export default function boundJoin (source: Observable<Bindings>, bgp: Algebra.TripleObject[], graph: Graph, options: Object): Observable<Bindings> {
  return new Observable(observer => {
    let sourceClosed = false
    let activeIterators = 0

    // utility function used to close the observable
    function tryClose () {
      activeIterators--
      if (sourceClosed && activeIterators === 0) {
        observer.complete()
      }
    }

    return source
      .pipe(bufferCount(BIND_JOIN_BUFFER_SIZE))
      .subscribe({
        next: bucket => {
          activeIterators++
          // simple case: first join in the pipeline
          if (bucket.length === 1 && bucket[0].isEmpty) {
            from(graph.evalBGP(bgp, options)).subscribe(b => {
              observer.next(b)
            }, err => observer.error(err), () => tryClose())
          } else {
            // create bound join and execute it
            const bgpBucket: BGPBucket = []
            const rewritingTable = new Map()
            let key = 0

            // build the BGP bucket
            bucket.map(binding => {
              const boundedBGP: Algebra.TripleObject[] = []
              bgp.forEach(triple => {
                let boundedTriple = binding.bound(triple)
                // rewrite triple and registerthe rewiriting
                boundedTriple = rewriteTriple(boundedTriple, key)
                rewritingTable.set(key, binding)
                boundedBGP.push(boundedTriple)
              })
              bgpBucket.push(boundedBGP)
              key++
            })
            // execute the bucket
            rewritingOp(graph, bgpBucket, rewritingTable, options)
              .subscribe(b => observer.next(b), err => observer.error(err), () => tryClose())
          }
        },
        error: err => observer.error(err),
        complete: () => { sourceClosed = true }
      })
  })
}