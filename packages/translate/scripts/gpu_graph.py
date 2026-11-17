#!/usr/bin/env python3
# ruff: noqa: E401, E701, E702, E731, E741
"""Builds the WebGPU graphs of a translation pack WITHOUT a second copy of the weights.

  python3 scripts/gpu_graph.py <export dir>      (the folder export.py --keep-fp32 wrote: encoder.onnx, decoder.onnx and _fp32/)

A graphics card runs floating-point graphs, and the pack's graphs are 8-bit integer graphs. Shipping float copies would double
the download. Instead this writes two small graph files, encoder.gpu.onnx and decoder.gpu.onnx, that hold only the wiring.
Every large tensor in them is declared as "stored elsewhere" and points at the byte range where that same tensor already sits
inside the 8-bit file the learner has: the 8-bit weights are read from there and turned into floats when the graph loads.
So one download serves both ways of running, and the weights the two ways use are the same numbers.
Needs onnx (build-time only).
"""
import os, sys
import onnx
from onnx import helper, TensorProto, numpy_helper

MIN_BYTES = 512  # smaller tensors stay inside the graph file


def build(out, name):
    q_path = os.path.join(out, f'{name}.onnx')
    blob = open(q_path, 'rb').read()
    q = onnx.load(q_path)
    f = onnx.load(os.path.join(out, '_fp32', f'{name}.onnx'))
    qinit = {t.name: t for t in q.graph.initializer}

    def locate(t):
        raw = t.raw_data
        if not raw or len(raw) < MIN_BYTES: return None
        at = blob.find(raw)
        return (at, len(raw)) if at >= 0 else None

    def external(name_, dtype, dims, at, length):
        t = TensorProto(); t.name = name_; t.data_type = dtype; t.dims.extend(dims)
        t.data_location = TensorProto.EXTERNAL
        for k, v in (('location', f'{name}.onnx'), ('offset', str(at)), ('length', str(length))):
            e = t.external_data.add(); e.key = k; e.value = v
        return t

    keep, nodes, shared, inside = [], [], 0, 0
    for t in f.graph.initializer:
        qw = qinit.get(t.name + '_quantized')
        if qw is not None and t.name + '_scale' in qinit and t.name + '_zero_point' in qinit:
            loc = locate(qw)
            assert loc, f'{t.name}: 8-bit bytes not found'
            keep.append(external(t.name + '_q', qw.data_type, list(qw.dims), *loc))
            s = numpy_helper.to_array(qinit[t.name + '_scale']); z = numpy_helper.to_array(qinit[t.name + '_zero_point'])
            keep.append(numpy_helper.from_array(s, t.name + '_s')); keep.append(numpy_helper.from_array(z, t.name + '_z'))
            nodes.append(helper.make_node('DequantizeLinear', [t.name + '_q', t.name + '_s', t.name + '_z'], [t.name]))
            shared += loc[1]; continue
        same = qinit.get(t.name)
        loc = locate(same) if same is not None and same.raw_data == t.raw_data and same.data_type == t.data_type else None
        if loc: keep.append(external(t.name, t.data_type, list(t.dims), *loc)); shared += loc[1]
        else: keep.append(t); inside += len(t.raw_data)
    del f.graph.initializer[:]; f.graph.initializer.extend(keep)
    old = list(f.graph.node); del f.graph.node[:]; f.graph.node.extend(nodes + old)
    f.producer_name = ''; f.producer_version = ''; f.doc_string = ''; f.graph.doc_string = ''; del f.metadata_props[:]
    for n in f.graph.node: n.doc_string = ''
    dst = os.path.join(out, f'{name}.gpu.onnx')
    with open(dst, 'wb') as fh: fh.write(f.SerializeToString())
    print(f'{name}.gpu.onnx {os.path.getsize(dst)} bytes; {shared} bytes read from {name}.onnx, {inside} bytes inside')


if __name__ == '__main__':
    for n in ('encoder', 'decoder'): build(sys.argv[1], n)
