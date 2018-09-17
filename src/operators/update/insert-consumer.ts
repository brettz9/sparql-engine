/* file : insert-consumer.ts
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

'use strict'

import { Consumer } from './consumer'
import Graph from '../../rdf/graph'
import { AsyncIterator } from 'asynciterator'
import { Algebra } from 'sparqljs'

/**
 * An InsertConsumer evaluates a SPARQL INSERT clause
 * @extends Consumer
 * @author Thomas Minier
 */
export default class InsertConsumer extends Consumer {
  readonly _graph: Graph
  constructor (source: AsyncIterator, graph: Graph, options: Object) {
    super(source, options)
    this._graph = graph
  }

  _write (triple: Algebra.TripleObject, encoding: string | undefined, done: (err?: Error) => void): void {
    this._graph.insert(triple)
      .then(() => done())
      .catch(err => {
        this.emit('error', err)
        done(err)
      })
  }
}
