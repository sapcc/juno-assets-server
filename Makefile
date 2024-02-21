# NOTE: 
# Hijack Build Container for debug
# fly -t v5 intercept -u URL_FROM_BUILD

FLY := fly -t v5
ci: ci-clean ci-create
	$(FLY) set-pipeline --pipeline juno-assets-server -c pipeline.yaml -l ./vars.yaml

login:
	$(FLY) login -c https://ci1.eu-de-2.cloud.sap -n services

ci-clean: 
	if [ -e pipeline.yaml ]; then rm pipeline.yaml; fi

ci-create: 
	docker run --rm -v "${CURDIR}":/myapp -w /myapp keppel.eu-de-1.cloud.sap/ccloud-dockerhub-mirror/library/ruby:3-alpine ruby pipeline/build.rb > pipeline.yaml 