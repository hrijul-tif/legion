"""Generates framework/jtyu/{command_schemas,parameter_schemas,commands.py,parameters.py} inside the WORK COPY of
mos-framework from a running Bifrost simulation's YAMCS MDB.

The framework's generators are written for FF (hard-coded `ff` directory, `/FF` parameter filter, credentials always
sent). Rather than editing them, this driver loads their source, applies four textual substitutions in memory and runs
the result from the framework/ directory exactly like `python3 main.py` would:

  "ff" directory            -> "jtyu"
  '"/FF" in'                -> '"/jTYU" in'      (parameter qualified names are /jTYU/<SUBSYSTEM>/<name>)
  Credentials(...) line     -> credentials = None  (the per-run YAMCS has no auth)

then the generate_commands.sh / generate_parameters.sh scripts run with MISSION="jtyu".
Usage: python -m mos_runner.genmdb <framework-copy-root> <yamcs-address> [instance]
"""
import os
import re
import subprocess
import sys
import types


def load(path, subs):
    src = open(path).read()
    for old, new in subs:
        if old not in src:
            raise SystemExit("generator source changed: %r not found in %s" % (old, path))
        src = src.replace(old, new)
    mod = types.ModuleType(os.path.basename(path)[:-3])
    mod.__file__ = path
    exec(compile(src, path, "exec"), mod.__dict__)
    return mod


def main():
    root, yamcs, instance = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else "jtyu")
    fw = os.path.join(root, "framework")
    os.chdir(fw)
    sys.path.insert(0, fw)
    env = dict(ENVIRONMENT="bifrost", MISSION="jtyu", INSTANCE=instance, YAMCS_URL=yamcs, YAMCS_USERNAME="", YAMCS_PASSWORD="",
               WDS_ENDPOINT="", WDS_PORT="", SLACK_BOT_TOKEN="")
    os.environ.update(env)
    with open(".env", "w") as fh:  # the generate_*.sh scripts `source` ./.env
        fh.write("".join("%s=%s\n" % kv for kv in env.items()))

    cred = re.compile(r"credentials = Credentials\(username=settings\.YAMCS_USERNAME, password=settings\.YAMCS_PASSWORD\)")
    ff_dirs_cmd = [('"ff"', '"jtyu"'), ("Credentials(username=settings.YAMCS_USERNAME, password=settings.YAMCS_PASSWORD)", "None")]
    ff_dirs_par = [('"ff"', '"jtyu"'), ("Credentials(username=settings.YAMCS_USERNAME, password=settings.YAMCS_PASSWORD)", "None"), ('"/FF" in', '"/jTYU" in')]
    for p in ("mdb/generate_command_schema.py", "mdb/generate_parameter_schema.py"):
        assert cred.search(open(p).read()), p

    os.makedirs("jtyu", exist_ok=True)
    cmd = load("mdb/generate_command_schema.py", ff_dirs_cmd)
    par = load("mdb/generate_parameter_schema.py", ff_dirs_par)
    cmd.generate_command_schema()
    par.generate_parameter_schema()

    bindir = os.path.dirname(sys.executable)
    envp = dict(os.environ, PATH=bindir + os.pathsep + os.environ["PATH"])
    for name in ("commands", "parameters"):
        script = open("mdb/generate_%s.sh" % name).read()
        if 'MISSION="ff"' not in script:
            raise SystemExit("generate_%s.sh changed" % name)
        tmp = "mdb/.gen_%s_jtyu.sh" % name
        open(tmp, "w").write(script.replace('MISSION="ff"', 'MISSION="jtyu"'))
        subprocess.run(["bash", tmp], check=True, env=envp)
        os.remove(tmp)
    open("jtyu/__init__.py", "a").close()
    print("generated framework/jtyu in", root)


main()
