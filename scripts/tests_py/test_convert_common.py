"""Tests for scripts/convert-common.py. The helpers that need onnx are skipped when onnx is not installed."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("convert_common", ROOT / "scripts" / "convert-common.py")
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


def test_sha256_file(tmp_path):
    p = tmp_path / "a.bin"
    p.write_bytes(b"abc" * 1000)
    assert cc.sha256_file(p, chunk=7) == hashlib.sha256(b"abc" * 1000).hexdigest()


def test_require_free_keeps_the_floor(tmp_path):
    free = cc.free_bytes(tmp_path)
    assert cc.require_free(0, tmp_path, floor=0) > 0
    with pytest.raises(cc.ConvertError, match="not enough disk"):
        cc.require_free(free, tmp_path, floor=cc.MIN_FREE_BYTES)
    assert cc.MIN_FREE_BYTES == int(2.5 * 1024**3)


def test_split_parts_matches_the_pack_format(tmp_path):
    body = bytes(range(256)) * 10  # 2560 bytes
    src = tmp_path / "model.onnx"
    src.write_bytes(body)
    e = cc.split_parts(src, tmp_path / "out", part_bytes=1000)
    assert [(p["path"], p["bytes"]) for p in e["parts"]] == [("model.onnx.p000", 1000), ("model.onnx.p001", 1000), ("model.onnx.p002", 560)]
    assert e["sha256"] == hashlib.sha256(body).hexdigest() and e["bytes"] == 2560
    joined = b"".join((tmp_path / "out" / p["path"]).read_bytes() for p in e["parts"])
    assert joined == body
    for p in e["parts"]:
        assert hashlib.sha256((tmp_path / "out" / p["path"]).read_bytes()).hexdigest() == p["sha256"]
    exact = cc.split_parts(src, tmp_path / "out2", part_bytes=1280)
    assert len(exact["parts"]) == 2  # no empty last part
    with pytest.raises(cc.ConvertError):
        cc.split_parts(src, tmp_path / "out3", part_bytes=cc.MAX_PART_BYTES + 1)


def test_pack_list_and_budget(tmp_path):
    src = tmp_path / "m.onnx"
    src.write_bytes(b"x" * 100)
    e = cc.split_parts(src, tmp_path / "words")
    path = cc.write_pack_list("words", "1", [e], tmp_path / "words")
    listed = json.loads(path.read_text())
    assert listed["schema"] == "alef.pack.v1" and listed["pack"] == "words" and listed["files"][0]["parts"][0]["bytes"] == 100
    assert cc.check_budget("words", [e]) == 100
    with pytest.raises(cc.ConvertError, match="over its budget"):
        cc.check_budget("handwriting", [{"bytes": 3 * cc.MIB}])
    with pytest.raises(cc.ConvertError, match="bad pack name"):
        cc.write_pack_list("../x", "1", [e], tmp_path)


def test_manifest_entry_refuses_dropped_models():
    assert cc.manifest_entry("dicta-il/dictabert-tiny-joint")["tier"] == "D"
    with pytest.raises(cc.ConvertError, match="dropped"):
        cc.manifest_entry("Xenova/nllb-200-distilled-600M")
    with pytest.raises(cc.ConvertError, match="not in models.manifest.json"):
        cc.manifest_entry("nobody/nothing")


def test_remove_is_quiet_about_missing_paths(tmp_path):
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "f").write_text("x")
    cc.remove(tmp_path / "d", tmp_path / "missing")
    assert not (tmp_path / "d").exists()


def test_strip_onnx_metadata(tmp_path):
    onnx = pytest.importorskip("onnx")
    from onnx import TensorProto, helper

    node = helper.make_node("Identity", ["x"], ["y"], doc_string="made by someone")
    graph = helper.make_graph([node], "g", [helper.make_tensor_value_info("x", TensorProto.FLOAT, [1])], [helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])], doc_string="notes")
    model = helper.make_model(graph, producer_name="some-tool", producer_version="9.9", doc_string="author notes")
    model.metadata_props.add(key="author", value="someone")
    p = tmp_path / "m.onnx"
    onnx.save(model, str(p))
    cc.strip_onnx_metadata(p)
    back = onnx.load(str(p))
    assert back.producer_name == "" and back.producer_version == "" and back.doc_string == ""
    assert len(back.metadata_props) == 0 and back.graph.doc_string == "" and back.graph.node[0].doc_string == ""
    assert back.graph.node[0].op_type == "Identity"
