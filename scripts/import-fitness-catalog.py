"""Reproducible catalog import. TACO 4th edition + wger CC BY-SA 4 videos.
Run from the project root. Requires Python 3 and ffmpeg. No credentials.
"""
import concurrent.futures
import csv
import io
import json
import pathlib
import subprocess
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = 'https://raw.githubusercontent.com/raulfdm/taco-api/main/references/csv/'

def fetch_json(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        return json.load(response)

def csv_rows(name):
    with urllib.request.urlopen(BASE + name + '.csv', timeout=60) as response:
        return list(csv.DictReader(io.StringIO(response.read().decode('utf-8'))))

# Portuguese coaching cues written for this catalog. Video names checked against
# the wger exerciseinfo endpoint; translations there are not always accurate.
EXERCISES = {
  12: ('Cadeira adutora', 'Pernas', 'Máquina', 'Apoie as costas, mantenha o tronco estável e aproxime as pernas de forma controlada. Retorne sem deixar os pesos baterem.'),
  46: ('Afundo com barra', 'Pernas', 'Barra', 'Com a barra apoiada nas costas, dê um passo e flexione os joelhos. Mantenha o pé da frente apoiado e retorne com controle.'),
  73: ('Supino reto com barra', 'Peito', 'Barra e banco', 'Apoie os pés e mantenha as escápulas estáveis no banco. Desça a barra em direção ao peito e empurre sem perder a posição dos ombros.'),
  75: ('Supino reto com halteres', 'Peito', 'Halteres e banco', 'Deite com os pés apoiados. Desça os halteres ao lado do peito e empurre de forma controlada, mantendo os punhos alinhados.'),
  82: ('Crucifixo inverso', 'Ombros', 'Halteres', 'Incline o tronco com a coluna estável. Abra os braços para os lados com leve flexão dos cotovelos e retorne devagar.'),
  91: ('Rosca direta com barra', 'Bíceps', 'Barra', 'Mantenha os cotovelos próximos ao corpo e flexione os braços. Evite impulsionar a barra com o tronco e controle a descida.'),
  92: ('Rosca com halteres', 'Bíceps', 'Halteres', 'Com o tronco estável, flexione os cotovelos sem mover os braços para a frente. Abaixe os halteres com controle.'),
  95: ('Rosca na polia', 'Bíceps', 'Polia baixa', 'Segure o acessório da polia baixa, mantenha os cotovelos junto ao corpo e flexione os braços. Controle o retorno.'),
  194: ('Mergulho nas paralelas', 'Peito', 'Barras paralelas', 'Sustente o corpo nas barras e flexione os cotovelos dentro de uma amplitude confortável. Empurre até retornar, sem balanço.'),
  205: ('Afundo com halteres', 'Pernas', 'Halteres', 'Segure os halteres ao lado do corpo, dê um passo e abaixe o quadril flexionando os joelhos. Empurre o chão para retornar.'),
  206: ('Passada com halteres', 'Pernas', 'Halteres', 'Avance alternando as pernas. Mantenha o tronco estável, apoie bem o pé da frente e evite bater o joelho de trás no chão.'),
  211: ('Tríceps francês com halter', 'Tríceps', 'Halter', 'Segure o halter acima da cabeça. Flexione os cotovelos mantendo os braços estáveis e estenda sem arquear a lombar.'),
  245: ('Tríceps testa com halteres', 'Tríceps', 'Halteres e banco', 'Deitado no banco, mantenha os braços elevados. Flexione os cotovelos trazendo os halteres ao lado da cabeça e estenda.'),
  246: ('Tríceps testa com barra W', 'Tríceps', 'Barra W e banco', 'Mantenha os braços firmes e flexione os cotovelos trazendo a barra em direção à testa. Estenda com controle.'),
  257: ('Agachamento frontal', 'Pernas', 'Barra', 'Apoie a barra à frente dos ombros e mantenha os cotovelos elevados. Agache com os pés firmes, controlando joelhos e tronco.'),
  272: ('Rosca martelo', 'Bíceps', 'Halteres', 'Com as palmas voltadas uma para a outra, flexione os cotovelos. Mantenha o tronco estável e controle a descida.'),
  275: ('Rosca martelo na corda', 'Bíceps', 'Polia e corda', 'Segure a corda na polia baixa com pegada neutra. Flexione os cotovelos sem impulsionar o tronco e retorne devagar.'),
  294: ('Elevação pélvica', 'Glúteos', 'Barra e banco', 'Apoie a parte superior das costas no banco e os pés no chão. Eleve o quadril contraindo os glúteos, sem hiperestender a lombar.'),
  341: ('Agachamento no Smith', 'Pernas', 'Smith', 'Posicione os pés para manter apoio estável. Flexione quadris e joelhos, desça de forma controlada e empurre o chão para subir.'),
  348: ('Elevação lateral', 'Ombros', 'Halteres', 'Com os cotovelos levemente flexionados, eleve os braços para os lados sem encolher os ombros. Desça com controle.'),
  349: ('Elevação lateral na polia', 'Ombros', 'Polia baixa', 'Segure a polia com uma mão e eleve o braço lateralmente. Mantenha o tronco estável e controle a volta.'),
  365: ('Mesa flexora', 'Posteriores', 'Máquina', 'Ajuste o apoio próximo aos tornozelos e mantenha o quadril apoiado. Flexione os joelhos e retorne devagar.'),
  366: ('Cadeira flexora', 'Posteriores', 'Máquina', 'Ajuste os apoios às pernas e mantenha as costas no encosto. Flexione os joelhos sem levantar o quadril.'),
  367: ('Flexora em pé', 'Posteriores', 'Máquina', 'Mantenha o quadril estável e flexione um joelho de cada vez. Controle a descida antes de repetir.'),
  371: ('Leg press', 'Pernas', 'Máquina', 'Mantenha as costas e o quadril apoiados. Flexione os joelhos em amplitude controlada e empurre a plataforma sem travar os joelhos.'),
  374: ('Leg press com base ampla', 'Pernas', 'Máquina', 'Posicione os pés mais afastados, com os joelhos acompanhando a direção dos pés. Desça sem perder o apoio do quadril.'),
  375: ('Agachamento hack', 'Pernas', 'Máquina hack', 'Apoie as costas e os ombros no equipamento. Flexione os joelhos e suba com os pés firmes na plataforma.'),
  465: ('Rosca Scott', 'Bíceps', 'Banco Scott e barra', 'Apoie os braços no banco, flexione os cotovelos e desça sem perder o apoio. Evite estender os cotovelos bruscamente.'),
  475: ('Barra fixa', 'Costas', 'Barra fixa', 'Com o corpo estável, puxe o peito em direção à barra. Desça com controle sem se soltar ou usar balanço.'),
  477: ('Barra fixa assistida', 'Costas', 'Graviton', 'Ajuste a assistência, apoie os joelhos na plataforma e puxe o corpo para cima. Retorne de forma controlada.'),
  507: ('Levantamento romeno', 'Posteriores', 'Barra', 'Com leve flexão dos joelhos, leve o quadril para trás e mantenha a barra próxima às pernas. Retorne estendendo o quadril.'),
  512: ('Remada baixa com pegada fechada', 'Costas', 'Polia baixa', 'Mantenha a coluna estável e puxe o acessório em direção ao abdômen. Leve os cotovelos para trás e retorne sem balançar o tronco.'),
  537: ('Supino inclinado com halteres', 'Peito', 'Halteres e banco inclinado', 'Apoie as costas no banco inclinado. Desça os halteres ao lado do peito e empurre mantendo os ombros estáveis.'),
  538: ('Supino inclinado com barra', 'Peito', 'Barra e banco inclinado', 'Com os pés apoiados, desça a barra em direção à parte superior do peito. Empurre mantendo os punhos alinhados.'),
  543: ('Desenvolvimento na máquina', 'Ombros', 'Máquina', 'Ajuste o banco e mantenha as costas apoiadas. Empurre as alças para cima e retorne sem elevar os ombros.'),
  567: ('Desenvolvimento com halteres', 'Ombros', 'Halteres e banco', 'Segure os halteres na altura dos ombros. Empurre para cima sem arquear a lombar e desça com controle.'),
  570: ('Encolhimento com halteres', 'Trapézio', 'Halteres', 'Eleve os ombros em direção às orelhas, sem girá-los. Mantenha os braços estendidos e controle a descida.'),
  575: ('Encolhimento no Smith', 'Trapézio', 'Smith', 'Segure a barra com os braços estendidos e eleve os ombros. Evite inclinar a cabeça ou girar os ombros.'),
  584: ('Rosca Scott unilateral', 'Bíceps', 'Halter e banco Scott', 'Apoie um braço no banco. Flexione o cotovelo sem mover o ombro e retorne devagar, mantendo o braço apoiado.'),
  590: ('Panturrilha sentada', 'Panturrilhas', 'Máquina', 'Apoie a parte da frente dos pés e eleve os calcanhares. Desça com controle, sem usar impulso.'),
  622: ('Panturrilha em pé', 'Panturrilhas', 'Máquina', 'Mantenha o corpo alinhado e eleve os calcanhares. Retorne lentamente, mantendo a parte da frente dos pés apoiada.'),
  655: ('Tríceps coice', 'Tríceps', 'Halter', 'Incline o tronco, mantenha o braço junto ao corpo e estenda o cotovelo para trás. Retorne sem mover o ombro.'),
  659: ('Tríceps na polia', 'Tríceps', 'Polia alta', 'Mantenha os cotovelos junto ao corpo e estenda os braços para baixo. Retorne com controle sem levar os ombros à frente.'),
  802: ('Passada com barra', 'Pernas', 'Barra', 'Com a barra apoiada, avance alternando as pernas. Mantenha o tronco estável e controle a descida a cada passo.'),
  803: ('Tríceps unilateral na polia', 'Tríceps', 'Polia alta', 'Com o cotovelo junto ao corpo, estenda o braço para baixo. Controle o retorno sem mover o ombro.'),
}

def build():
    categories = {r['id']: r['name'] for r in csv_rows('categories')}
    nutrients = {r['foodId']: r for r in csv_rows('nutrients')}
    foods = []
    for row in csv_rows('food'):
        n = nutrients[row['id']]
        values = {}
        unknown = []
        for field, key in [('kcal', 'kcal'), ('protein', 'protein'), ('carbs', 'carbohydrates'), ('fat', 'lipids')]:
            raw = n[key].strip()
            try: values[field] = float(raw)
            except ValueError:
                values[field] = 0
                unknown.append(field)
        if 'kcal' in unknown: continue
        foods.append({'id': 'taco-' + row['id'], 'name': row['name'], 'category': categories[row['categoryId']],
                      **values, 'source': 'TACO · NEPA/UNICAMP · 4ª edição', 'traceFields': unknown})
    videos = fetch_json('https://wger.de/api/v2/video/?limit=100')['results']
    target = ROOT / 'public' / 'videos'
    target.mkdir(exist_ok=True)
    def convert(exercise_id):
        selected = min((v for v in videos if v['exercise'] == exercise_id), key=lambda v: v['size'])
        destination = target / f'wger-{exercise_id}.mp4'
        if not destination.exists():
            with tempfile.TemporaryDirectory(prefix='ms-video-') as tmp:
                source = pathlib.Path(tmp) / 'source.mov'
                with urllib.request.urlopen(selected['video'], timeout=180) as response, source.open('wb') as output:
                    while chunk := response.read(1024 * 1024): output.write(chunk)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-vf', 'scale=640:-2', '-r', '24',
                                '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '27', '-pix_fmt', 'yuv420p',
                                '-an', '-movflags', '+faststart', str(destination)], check=True)
        name, category, equipment, instructions = EXERCISES[exercise_id]
        thumbnail = destination.with_suffix('.webp')
        if not thumbnail.exists():
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '1', '-i', str(destination), '-frames:v', '1', '-vf', 'scale=480:-2', str(thumbnail)], check=True)
        print(f'Vídeo {exercise_id} pronto', flush=True)
        return {'id': f'wger-{exercise_id}', 'name': name, 'category': category, 'equipment': equipment, 'instructions': instructions,
                'videoUrl': f'/videos/wger-{exercise_id}.mp4', 'sourceUrl': selected['video'], 'author': selected['license_author'],
                'license': 'CC BY-SA 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
                'changes': 'Vídeo redimensionado, recodificado e sem áudio.'}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        exercises = list(pool.map(convert, EXERCISES))
    (ROOT / 'server' / 'fitness-catalog.json').write_text(json.dumps({'foods': foods, 'exercises': exercises}, ensure_ascii=False), encoding='utf-8')
    print(f'Catálogo pronto: {len(foods)} alimentos e {len(exercises)} vídeos.', flush=True)

if __name__ == '__main__': build()
